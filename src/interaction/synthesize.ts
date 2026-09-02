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
    values[index] = standardized * CSD4CA_MODEL.scales[index % CSD4CA_MODEL.stride]!;
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

function sample(next: Random): { readonly duration: number; readonly values: readonly number[] } {
  const group = chooseGroup(next);
  let values = reconstruct(group, next);
  if (!isUpward(values)) values = reconstruct(group, next);
  if (!isUpward(values)) values = reconstruct(group, next, false);
  const [meanLog, deviationLog, minimum, maximum] = group.duration;
  const duration = clamp(Math.exp(meanLog + deviationLog * normal(next)), minimum, maximum);
  return { duration, values };
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

function synthesizeMotion(next: Random): InteractionFrame[] {
  const { duration, values } = sample(next);
  const frames: InteractionFrame[] = [];
  const motionDuration = clamp(duration, 180, 400);
  const interval = Math.round(motionDuration / (CSD4CA_MODEL.frames - 1));
  for (let index = 0; index < CSD4CA_MODEL.frames; index += 1) {
    const at = Math.round(motionDuration * index / (CSD4CA_MODEL.frames - 1));
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
  return frames;
}

function synthesizeSwipe(next: Random): InteractionFrame[] {
  const { duration, values } = sample(next);
  const frames: InteractionFrame[] = [];
  for (let index = 0; index < CSD4CA_MODEL.frames; index += 1) {
    const at = Math.round(duration * index / (CSD4CA_MODEL.frames - 1));
    frames.push(Object.freeze({
      kind: 'touch',
      phase: touchPhase(index),
      at,
      x: round(clamp(frameValue(values, index, CHANNEL.touchX), 0.01, 0.99), 6),
      y: round(clamp(frameValue(values, index, CHANNEL.touchY), 0.01, 0.99), 6),
      radiusX: round(clamp(frameValue(values, index, CHANNEL.radiusX), 0.001, 0.15), 6),
      radiusY: round(clamp(frameValue(values, index, CHANNEL.radiusY), 0.001, 0.15), 6),
      force: round(clamp(frameValue(values, index, CHANNEL.force), 0, 1), 6),
    } satisfies TouchFrame));
  }
  return frames;
}

export function synthesizeInteraction(recipe: InteractionRecipe, seed: string, sequence: number): readonly InteractionFrame[] {
  const next = createRandom(hashSeed(`${seed}\u0000${sequence}\u0000${recipe}`));
  return Object.freeze(recipe === 'motion-burst' ? synthesizeMotion(next) : synthesizeSwipe(next));
}
