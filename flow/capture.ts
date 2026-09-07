import path from 'node:path';
import { WorkerExecutor } from '../src/executor/pool.js';
import { DEFAULT_PROFILES_ROOT } from '../src/node/assets.js';
import { FpEnvProfiles } from '../src/profiles/fp-env.js';
import { parseCaptureResult } from '../src/core/capture.js';
import type { CaptureNetworkOptions } from '../src/network/types.js';
import { digest, seal } from '../src/core/seal.js';
import type { EnvironmentOptions, Page } from '../src/core/types.js';

export type CaptureMode = 'abck' | 'bms';

export interface CaptureBodiesOptions {
  pageUrl: string;
  pageHtml: string;
  scriptUrl: string;
  scriptSource: string;
  cookies?: readonly string[];
  profile: string;
  environment?: EnvironmentOptions;
  profilesRoot?: string;
  deadlineMs: number;
  scriptTimeoutMs: number;
  maxPosts: number;
  mode: CaptureMode;
  interactionSeed?: string;
  network?: CaptureNetworkOptions;
}

export interface CapturedPost {
  via: string;
  tag: string;
  len: number;
}

export interface CaptureBodiesResult {
  bodies: readonly string[];
  posts: readonly CapturedPost[];
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
}

function capturePage(options: CaptureBodiesOptions): Page {
  const material = {
    pageUrl: options.pageUrl,
    pageHtml: options.pageHtml,
    cookies: options.cookies ?? [],
    mode: options.mode,
  };
  const hash = digest(material);
  return seal({
    schema: 2,
    id: `flow-${hash.slice(0, 16)}`,
    source: { kind: 'manual', hash },
    url: options.pageUrl,
    html: options.pageHtml,
    cookies: [...(options.cookies ?? [])],
  });
}

function captureInteraction(options: CaptureBodiesOptions) {
  if (options.mode === 'bms') return undefined;
  if (!options.interactionSeed) {
    throw new TypeError('interactionSeed is required for ABCK capture');
  }
  return { adapter: 'akamai-sensor' as const, seed: options.interactionSeed };
}

const EXECUTOR_CACHE_LIMIT = 8;

export class CapturePool {
  private readonly executors = new Map<string, WorkerExecutor>();
  private readonly networkExecutors = new Set<WorkerExecutor>();
  private readonly retiring = new Set<Promise<void>>();
  private closing: Promise<void> | undefined;

  constructor(private readonly size = 1) {
    positiveInteger(size, 'size');
  }

  async capture(options: CaptureBodiesOptions): Promise<CaptureBodiesResult> {
    if (this.closing) throw new Error('CapturePool is closed');
    positiveInteger(options.deadlineMs, 'deadlineMs');
    positiveInteger(options.scriptTimeoutMs, 'scriptTimeoutMs');
    positiveInteger(options.maxPosts, 'maxPosts');
    const interaction = captureInteraction(options);
    const config = {
      profilesRoot: path.resolve(options.profilesRoot ?? DEFAULT_PROFILES_ROOT),
      size: this.size,
      timeoutMs: options.scriptTimeoutMs + options.deadlineMs + 5_000,
      capture: {
        deadlineMs: options.deadlineMs,
        pollMs: 10,
        maxPosts: options.maxPosts,
        lifecycle: 'auto' as const,
      },
    };
    const key = JSON.stringify(config);
    let executor = options.network === undefined ? this.executors.get(key) : undefined;
    if (!executor && options.network === undefined && this.executors.size >= EXECUTOR_CACHE_LIMIT) {
      const idle = [...this.executors].find(([, candidate]) => candidate.active === 0 && candidate.queued === 0);
      if (!idle) throw new Error('CapturePool configuration capacity exceeded');
      const [idleKey, idleExecutor] = idle;
      this.executors.delete(idleKey);
      const retiring = idleExecutor.destroy();
      this.retiring.add(retiring);
      void retiring.then(() => this.retiring.delete(retiring), () => this.retiring.delete(retiring));
    }
    executor ??= new WorkerExecutor({ ...config, ...(options.network === undefined ? {} : { network: options.network }) });
    if (options.network === undefined) {
      this.executors.delete(key);
      this.executors.set(key, executor);
    } else {
      // Cookie snapshots and request callbacks belong to one capture, never a cached executor.
      this.networkExecutors.add(executor);
    }

    try {
      const result = parseCaptureResult(await executor.run({
        profile: options.profile,
        ...(options.environment === undefined ? {} : { environment: options.environment }),
        page: capturePage(options),
        job: {
          kind: 'capture',
          code: options.scriptSource,
          scriptUrl: options.scriptUrl,
          timeout: options.scriptTimeoutMs,
          trace: true,
          ...(interaction === undefined ? {} : { interaction }),
        },
      }));
      if (!result.ok) {
        throw new Error(`mimic capture failed: ${result.error.code}: ${result.error.message}`);
      }
      const posts = result.value.posts;
      return {
        bodies: posts.flatMap((post) => post.body === null || post.body.length === 0 ? [] : [post.body]),
        posts: posts.map(({ via, tag, len }) => ({ via, tag, len })),
      };
    } finally {
      if (options.network !== undefined) {
        try {
          await executor.destroy();
        } finally {
          this.networkExecutors.delete(executor);
        }
      }
    }
  }

  close(): Promise<void> {
    this.closing ??= Promise.all([
      ...Array.from(this.executors.values(), (executor) => executor.destroy()),
      ...Array.from(this.networkExecutors, (executor) => executor.destroy()),
      ...this.retiring,
    ]).then(() => { this.executors.clear(); });
    return this.closing;
  }
}

export async function captureBodies(options: CaptureBodiesOptions, pool?: CapturePool): Promise<CaptureBodiesResult> {
  if (pool) return pool.capture(options);
  const owned = new CapturePool();
  try {
    return await owned.capture(options);
  } finally {
    await owned.close();
  }
}

export async function listAndroidChromeProfiles(profilesRoot?: string): Promise<readonly string[]> {
  const profiles = await new FpEnvProfiles(profilesRoot ?? DEFAULT_PROFILES_ROOT).list();
  return profiles.filter((profile) => profile.startsWith('android-chrome/'));
}
