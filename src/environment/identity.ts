import { createHash } from 'node:crypto';
import type { AudioData, Profile } from '../core/types.js';
import { audioRound6, asFloat32 } from '../features/audio.shared.js';
export { resolveSystemColors, synthesizeSystemColors, systemColorsOrigin } from './system-colors.js';

export const IDENTITY_POLICY_REVISION = 'legacy-identity-v1';
export const EMPTY_CANVAS_DATA_URL = 'data:image/png;base64,';
export const CANVAS_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function synthesizeCanvasDataURL(id: string, mime = 'image/png'): string {
  const type = (CANVAS_MIMES as readonly string[]).includes(mime) ? mime : 'image/png';
  const payload = createHash('sha256').update(`canvas-fp:${id}:${type}`).digest('base64');
  return `data:${type};base64,${payload}`;
}

export function resolveCanvasURLs(profile: Profile): Record<typeof CANVAS_MIMES[number], string> {
  const raw = profile.canvas?.toDataURL;
  return {
    'image/png': raw?.startsWith('data:image/png') && raw.length > EMPTY_CANVAS_DATA_URL.length ? raw : synthesizeCanvasDataURL(profile.id),
    'image/jpeg': synthesizeCanvasDataURL(profile.id, 'image/jpeg'),
    'image/webp': synthesizeCanvasDataURL(profile.id, 'image/webp'),
  };
}

/** Value that survives Float32Array fill and six-decimal fingerprint rounding. */
function fingerprintSample(value: number): number {
  return audioRound6(asFloat32(value));
}

/**
 * Deterministic OfflineAudio 4-tuple from a stable id (profile id).
 * Ranges approximate real offline triangle+compressor/analyser sums so the
 * JSON object is non-zero and leaves the all-zero cluster `85eefa4e`.
 */
export function synthesizeAudioFingerprint(id: string): AudioData {
  const buf = createHash('sha256').update(`audio-fp:${id}`).digest();
  const u = (i: number): number => (buf[i] ?? 0) / 255;
  // f32 then 6-dec so getChannelData/getFloat* fill matches BMS reduce path.
  const sampleSum = fingerprintSample(20 + u(0) * 160 + u(1));
  const freqSum = fingerprintSample(-8000 - u(2) * 40000 - u(3) * 100);
  const timeSum = fingerprintSample((u(4) - 0.5) * 0.02);
  const reduction = fingerprintSample(u(5) < 0.7 ? 0 : -(u(6) * 5));
  return { reduction, sampleSum, freqSum, timeSum };
}
/** Prefer captured profile.audio; otherwise synthesize from profile.id. */
export function resolveAudioFingerprint(profile: Profile): AudioData {
  if (profile.audio) {
    return {
      reduction: fingerprintSample(profile.audio.reduction),
      sampleSum: fingerprintSample(profile.audio.sampleSum),
      freqSum: fingerprintSample(profile.audio.freqSum),
      timeSum: fingerprintSample(profile.audio.timeSum),
    };
  }
  return synthesizeAudioFingerprint(profile.id);
}

