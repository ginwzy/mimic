import path from 'node:path';
import { WorkerExecutor } from '../src/executor/pool.js';
import { DEFAULT_PROFILES_ROOT } from '../src/node/assets.js';
import { FpEnvProfiles } from '../src/node/fp-env.js';
import { digest, seal } from '../src/core/seal.js';
import type { Page } from '../src/core/types.js';

export type CaptureMode = 'abck' | 'bms';

export interface CaptureBodiesOptions {
  pageUrl: string;
  pageHtml: string;
  scriptUrl: string;
  scriptSource: string;
  cookies?: readonly string[];
  profile: string;
  profilesRoot?: string;
  deadlineMs: number;
  scriptTimeoutMs: number;
  maxPosts: number;
  mode: CaptureMode;
  interactionSeed?: string;
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

interface CapturedBodyPost extends CapturedPost {
  body: string | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function isCapturedBodyPost(value: unknown): value is CapturedBodyPost {
  if (!isRecord(value)) return false;
  return typeof value.via === 'string'
    && typeof value.tag === 'string'
    && typeof value.len === 'number'
    && (typeof value.body === 'string' || value.body === null);
}

function capturedPosts(value: unknown): CapturedBodyPost[] {
  if (!isRecord(value) || !Array.isArray(value.posts)) return [];
  return value.posts.filter(isCapturedBodyPost);
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
    let executor = this.executors.get(key);
    if (!executor && this.executors.size >= EXECUTOR_CACHE_LIMIT) {
      const idle = [...this.executors].find(([, candidate]) => candidate.active === 0 && candidate.queued === 0);
      if (!idle) throw new Error('CapturePool configuration capacity exceeded');
      const [idleKey, idleExecutor] = idle;
      this.executors.delete(idleKey);
      const retiring = idleExecutor.destroy();
      this.retiring.add(retiring);
      void retiring.then(() => this.retiring.delete(retiring), () => this.retiring.delete(retiring));
    }
    executor ??= new WorkerExecutor(config);
    this.executors.delete(key);
    this.executors.set(key, executor);

    const result = await executor.run({
      profile: options.profile,
      page: capturePage(options),
      job: {
        kind: 'capture',
        code: options.scriptSource,
        scriptUrl: options.scriptUrl,
        timeout: options.scriptTimeoutMs,
        trace: true,
        ...(interaction === undefined ? {} : { interaction }),
      },
    });
    if (!result.ok) {
      throw new Error(`mimic capture failed: ${result.error.code}: ${result.error.message}`);
    }
    const posts = capturedPosts(result.value);
    return {
      bodies: posts.flatMap((post) => post.body === null || post.body.length === 0 ? [] : [post.body]),
      posts: posts.map(({ via, tag, len }) => ({ via, tag, len })),
    };
  }

  close(): Promise<void> {
    this.closing ??= Promise.all([
      ...Array.from(this.executors.values(), (executor) => executor.destroy()),
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
