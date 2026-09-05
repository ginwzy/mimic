import type { CaptureOptions } from '../app/types.js';

export interface CaptureConfig {
  readonly deadlineMs: number;
  readonly pollMs: number;
  readonly maxPosts: number;
  readonly lifecycle: NonNullable<CaptureOptions['lifecycle']>;
}

function positive(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

export function captureConfig(input: CaptureOptions = {}): CaptureConfig {
  const lifecycle = input.lifecycle ?? 'auto';
  if (lifecycle !== 'auto' && lifecycle !== 'none') {
    throw new TypeError('capture.lifecycle must be auto or none');
  }
  return Object.freeze({
    deadlineMs: positive(input.deadlineMs, 1_000, 'capture.deadlineMs'),
    pollMs: positive(input.pollMs, 10, 'capture.pollMs'),
    maxPosts: positive(input.maxPosts, 1, 'capture.maxPosts'),
    lifecycle,
  });
}
