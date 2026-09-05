export const FLOAT32 = 'window.Float32Array';

/** Round to six decimals before encoding fingerprint output. */
export function audioRound6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Float32Array stores channel/analyser samples; match that rounding before toFixed(6). */
export function asFloat32(value: number): number {
  return new Float32Array([value])[0]!;
}
