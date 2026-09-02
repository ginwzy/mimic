import { CSD4CA_MODEL } from './csd4ca.model.js';
import type { InteractionModelGroup } from './model.js';
import type {
  InteractionFrame,
  InteractionRecipe,
  MotionFrame,
  OrientationFrame,
  TouchFrame,
} from './types.js';

type Random = () => number;

interface GestureSample {
  readonly touchDuration: number;
  readonly sensorStartOffset: number;
  readonly sensorDuration: number;
  readonly values: readonly number[];
}

const CHANNEL = {
  touchX: 0,
  touchY: 1,
  radiusX: 2,
  radiusY: 3,
  force: 4,
  acceleration: 5,
  gravity: 8,
  rotation: 11,
  orientationSinAlpha: 14,
  orientationCosAlpha: 15,
  orientationBeta: 16,
  orientationGamma: 17,
} as const;

const UP_GROUPS = CSD4CA_MODEL.groups.filter((group) => group.direction === 'up');
const FRAME_VALUE_COUNT = CSD4CA_MODEL.frames * CSD4CA_MODEL.stride;
const TIMING_INDEX = {
  touchLogDuration: FRAME_VALUE_COUNT,
  sensorStartOffset: FRAME_VALUE_COUNT + 1,
  sensorEndOffset: FRAME_VALUE_COUNT + 2,
} as const;

function hashSeed(input: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function normal(next: Random): number {
  const radius = Math.sqrt(-2 * Math.log(Math.max(next(), Number.EPSILON)));
  return clamp(radius * Math.cos(2 * Math.PI * next()), -2.5, 2.5);
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function chooseGroup(next: Random): InteractionModelGroup {
  const total = UP_GROUPS.reduce((sum, group) => sum + group.count, 0);
  let selected = next() * total;
  for (const group of UP_GROUPS) {
    selected -= group.count;
    if (selected < 0) return group;
  }
  const fallback = UP_GROUPS.at(-1);
  if (!fallback) throw new TypeError('CSD4CA interaction model has no upward swipe groups');
  return fallback;
}

function reconstruct(group: InteractionModelGroup, next: Random, varied = true): number[] {
  const coefficients = group.components.map(() => varied ? normal(next) : 0);
  const values = new Array<number>(group.mean.length);
  for (let index = 0; index < group.mean.length; index += 1) {
    let standardized = group.mean[index]! / CSD4CA_MODEL.quantization;
    for (let componentIndex = 0; componentIndex < group.components.length; componentIndex += 1) {
      const component = group.components[componentIndex]!;
      standardized += coefficients[componentIndex]! * component.sigma
        * component.basis[index]! / CSD4CA_MODEL.quantization;
    }
    const scale = index < FRAME_VALUE_COUNT
      ? CSD4CA_MODEL.scales[index % CSD4CA_MODEL.stride]!
      : CSD4CA_MODEL.timingScales[index - FRAME_VALUE_COUNT]!;
    values[index] = standardized * scale;
  }
  return values;
}

function frameValue(values: readonly number[], frame: number, channel: number): number {
  return values[frame * CSD4CA_MODEL.stride + channel]!;
}

function isUpward(values: readonly number[]): boolean {
  const first = frameValue(values, 0, CHANNEL.touchY);
  const last = frameValue(values, CSD4CA_MODEL.frames - 1, CHANNEL.touchY);
  return first - last >= 0.08;
}

function decodeSample(group: InteractionModelGroup, values: readonly number[]): GestureSample | null {
  if (!isUpward(values)) return null;
  const bounds = group.timingBounds;
  const touchDuration = clamp(Math.exp(values[TIMING_INDEX.touchLogDuration]!), ...bounds.touchDuration);
  const sensorStartOffset = clamp(values[TIMING_INDEX.sensorStartOffset]!, ...bounds.sensorStartOffset);
  const sensorEndOffset = clamp(values[TIMING_INDEX.sensorEndOffset]!, ...bounds.sensorEndOffset);
  const sensorDuration = touchDuration + sensorEndOffset - sensorStartOffset;
  if (
    sensorDuration < CSD4CA_MODEL.calibration.minimumDurationMs
    || sensorDuration > CSD4CA_MODEL.calibration.maximumDurationMs
  ) return null;
  return { touchDuration, sensorStartOffset, sensorDuration, values };
}

function sample(next: Random): GestureSample {
  const group = chooseGroup(next);
  let values = reconstruct(group, next);
  let decoded = decodeSample(group, values);
  if (decoded) return decoded;
  values = reconstruct(group, next);
  decoded = decodeSample(group, values);
  if (decoded) return decoded;
  decoded = decodeSample(group, reconstruct(group, next, false));
  if (!decoded) throw new TypeError('CSD4CA interaction model group has an invalid mean gesture');
  return decoded;
}

function frameTriple(values: readonly number[], frame: number, start: number): readonly [number, number, number] {
  return [
    round(frameValue(values, frame, start)),
    round(frameValue(values, frame, start + 1)),
    round(frameValue(values, frame, start + 2)),
  ];
}

function touchPhase(index: number): TouchFrame['phase'] {
  if (index === 0) return 'start';
  if (index === CSD4CA_MODEL.frames - 1) return 'end';
  return 'move';
}

function createTouchFrame(
  values: readonly number[],
  index: number,
  phase: TouchFrame['phase'],
  at: number,
): TouchFrame {
  return Object.freeze({
    kind: 'touch',
    phase,
    at,
    x: round(clamp(frameValue(values, index, CHANNEL.touchX), 0.01, 0.99), 6),
    y: round(clamp(frameValue(values, index, CHANNEL.touchY), 0.01, 0.99), 6),
    radiusX: round(clamp(frameValue(values, index, CHANNEL.radiusX), 0.001, 0.15), 6),
    radiusY: round(clamp(frameValue(values, index, CHANNEL.radiusY), 0.001, 0.15), 6),
    force: round(clamp(frameValue(values, index, CHANNEL.force), 0, 1), 6),
  });
}

function appendSensorFrames(
  frames: InteractionFrame[],
  values: readonly number[],
  start: number,
  duration: number,
): void {
  const interval = Math.max(1, Math.round(duration / (CSD4CA_MODEL.frames - 1)));
  for (let index = 0; index < CSD4CA_MODEL.frames; index += 1) {
    const at = Math.round(start + duration * index / (CSD4CA_MODEL.frames - 1));
    frames.push(Object.freeze({
      kind: 'motion',
      at,
      acceleration: frameTriple(values, index, CHANNEL.acceleration),
      gravity: frameTriple(values, index, CHANNEL.gravity),
      rotation: frameTriple(values, index, CHANNEL.rotation),
      interval,
    } satisfies MotionFrame));
    const alpha = Math.atan2(
      frameValue(values, index, CHANNEL.orientationSinAlpha),
      frameValue(values, index, CHANNEL.orientationCosAlpha),
    ) * 180 / Math.PI;
    frames.push(Object.freeze({
      kind: 'orientation',
      at,
      alpha: round((alpha + 360) % 360, 1),
      beta: round(clamp(frameValue(values, index, CHANNEL.orientationBeta), -180, 180), 1),
      gamma: round(clamp(frameValue(values, index, CHANNEL.orientationGamma), -90, 90), 1),
    } satisfies OrientationFrame));
  }
}

function synthesizeSwipe(next: Random): InteractionFrame[] {
  const { touchDuration, sensorStartOffset, sensorDuration, values } = sample(next);
  const frames: InteractionFrame[] = [];
  const programStart = Math.min(0, sensorStartOffset);
  const touchStart = -programStart;
  const sensorStart = sensorStartOffset - programStart;
  for (let index = 0; index < CSD4CA_MODEL.frames; index += 1) {
    const at = Math.round(touchStart + touchDuration * index / (CSD4CA_MODEL.frames - 1));
    frames.push(createTouchFrame(values, index, touchPhase(index), at));
  }
  appendSensorFrames(frames, values, sensorStart, sensorDuration);
  frames.sort((left, right) => left.at - right.at);
  return frames;
}

function synthesizeTap(next: Random): InteractionFrame[] {
  // CSD4CA has no taps; retain only its captured contact-start marginal.
  const { values } = sample(next);
  const duration = Math.round(70 + next() * 60);
  return [
    createTouchFrame(values, 0, 'start', 0),
    createTouchFrame(values, 0, 'end', duration),
  ];
}

export function synthesizeInteraction(recipe: InteractionRecipe, seed: string, sequence: number): readonly InteractionFrame[] {
  const next = createRandom(hashSeed(`${seed}\u0000${sequence}\u0000${recipe}`));
  switch (recipe) {
    case 'swipe':
      return Object.freeze(synthesizeSwipe(next));
    case 'tap':
      return Object.freeze(synthesizeTap(next));
  }
}
