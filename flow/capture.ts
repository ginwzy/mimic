import { createMimic } from '../src/public.js';
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

export async function captureBodies(options: CaptureBodiesOptions): Promise<CaptureBodiesResult> {
  positiveInteger(options.deadlineMs, 'deadlineMs');
  positiveInteger(options.scriptTimeoutMs, 'scriptTimeoutMs');
  positiveInteger(options.maxPosts, 'maxPosts');
  const interaction = captureInteraction(options);

  const mimic = createMimic({
    profile: options.profile,
    ...(options.profilesRoot === undefined ? {} : { profilesRoot: options.profilesRoot }),
    page: capturePage(options),
    size: 1,
    timeoutMs: options.scriptTimeoutMs + options.deadlineMs + 5_000,
    capture: {
      deadlineMs: options.deadlineMs,
      pollMs: 10,
      maxPosts: options.maxPosts,
      lifecycle: 'auto',
    },
  });

  try {
    const result = await mimic.capture({
      kind: 'capture',
      code: options.scriptSource,
      scriptUrl: options.scriptUrl,
      timeout: options.scriptTimeoutMs,
      trace: true,
      ...(interaction === undefined ? {} : { interaction }),
    });
    if (!result.ok) {
      throw new Error(`mimic capture failed: ${result.error.code}: ${result.error.message}`);
    }
    const posts = capturedPosts(result.value);
    return {
      bodies: posts.flatMap((post) => post.body === null || post.body.length === 0 ? [] : [post.body]),
      posts: posts.map(({ via, tag, len }) => ({ via, tag, len })),
    };
  } finally {
    await mimic.close();
  }
}

export async function listAndroidChromeProfiles(profilesRoot?: string): Promise<readonly string[]> {
  const mimic = createMimic({
    ...(profilesRoot === undefined ? {} : { profilesRoot }),
    size: 1,
  });
  try {
    const profiles = await mimic.list('profiles');
    return profiles.filter((profile) => profile.startsWith('android-chrome/'));
  } finally {
    await mimic.close();
  }
}
