import { MimicError } from './error.js';
import { parseResult } from './result.js';
import type { Data, Result } from './types.js';

export interface CapturePost extends Data {
  via: string;
  tag: string;
  len: number;
  body: string | null;
}

export interface CaptureValue extends Data {
  syncCaptured: boolean;
  captured: string | null;
  posts: CapturePost[];
}

export type CaptureResult =
  | (Extract<Result<CaptureValue>, { ok: true }> & { value: CaptureValue })
  | Extract<Result, { ok: false }>;

export interface NetReport {
  body: string | null;
  posts: CapturePost[];
  pending?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function post(value: unknown): value is CapturePost {
  return record(value) && typeof value.via === 'string' && typeof value.tag === 'string'
    && typeof value.len === 'number' && (typeof value.body === 'string' || value.body === null);
}

/** Runtime reports may come from custom Drivers; retain the established tolerant projection. */
export function captureReport(report: Data): NetReport {
  const data = report.net;
  if (!record(data)) return { body: null, posts: [] };
  const posts = Array.isArray(data.posts) ? data.posts.filter(post) : [];
  return {
    body: typeof data.body === 'string' ? data.body : null,
    posts: posts.map(item => ({ ...item })),
    ...(typeof data.pending === 'number' ? { pending: data.pending } : {}),
  };
}

/** Refine the existing v2 Result after its JSON/schema validation, without adding wire fields. */
export function parseCaptureResult(input: unknown): CaptureResult {
  const result = parseResult(input);
  if (!result.ok) return result;
  const value = result.value;
  if (!record(value) || typeof value.syncCaptured !== 'boolean'
    || (typeof value.captured !== 'string' && value.captured !== null)
    || !Array.isArray(value.posts) || !value.posts.every(post)) {
    throw new MimicError({ phase: 'parse', code: 'BAD_RESULT', message: 'Capture Result has an invalid value' });
  }
  return result as CaptureResult;
}
