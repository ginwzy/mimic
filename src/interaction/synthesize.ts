import { Buffer } from 'node:buffer';
import { CSD4CA_MODEL } from './csd4ca.model.js';
import type { InteractionModelGroup, InteractionModelPoseTransitions } from './model.js';
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

export interface InteractionSession {
  readonly seed: string;
  readonly group: InteractionModelGroup;
  readonly transitions: InteractionModelPoseTransitions;
  gravity: [number, number, number];
  heading: number;
  swipeCount: number;
  lastSwipeAt?: number;
  alphaReference?: number;
}

const CHANNEL = {
  touchX: 0,
  touchY: 1,
  radiusX: 2,
  radiusY: 3,
  force: 4,
  acceleration: 5,
  rotation: 8,
  orientationSinAlpha: 11,
  orientationCosAlpha: 12,
} as const;

const UP_GROUPS = CSD4CA_MODEL.groups.filter((group) => group.direction === 'up');
const FRAME_VALUE_COUNT = CSD4CA_MODEL.frames * CSD4CA_MODEL.stride;
const TIMING_INDEX = {
  touchLogDuration: FRAME_VALUE_COUNT,
  sensorStartOffset: FRAME_VALUE_COUNT + 1,
  sensorEndOffset: FRAME_VALUE_COUNT + 2,
} as const;
const TRANSITION_GAP_TOLERANCE_RATIO = 0.25;
const MIN_TRANSITION_GAP_TOLERANCE_MS = 250;

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

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function chooseGroup(next: Random): InteractionModelGroup {
  const total = UP_GROUPS.reduce((sum, group) => sum + group.sessions.length, 0);
  let selected = next() * total;
  for (const group of UP_GROUPS) {
    selected -= group.sessions.length;
    if (selected < 0) return group;
  }
  const fallback = UP_GROUPS.at(-1);
  if (!fallback) throw new TypeError('CSD4CA interaction model has no upward swipe groups');
  return fallback;
}

export function createInteractionSession(seed: string): InteractionSession {
  const next = createRandom(hashSeed(`${seed}\u0000session`));
  const group = chooseGroup(next);
  const pose = group.sessions[Math.min(group.sessions.length - 1, Math.floor(next() * group.sessions.length))];
  if (!pose) throw new TypeError('CSD4CA interaction model group has no session poses');
  return { seed, group, transitions: pose.transitions, gravity: [...pose.gravity], heading: 0, swipeCount: 0 };
}

function advanceSessionPose(session: InteractionSession, next: Random, elapsedMs: number): void {
  if (session.swipeCount > 0) {
    const transitions = session.transitions;
    if (transitions.count === 0) throw new TypeError('CSD4CA interaction model session has no pose transitions');
    if (session.lastSwipeAt === undefined) throw new TypeError('CSD4CA interaction session has no prior swipe time');
    const data = Buffer.from(transitions.data, 'base64');
    const stride = CSD4CA_MODEL.transitionQuantization.length * 2;
    const targetGap = elapsedMs - session.lastSwipeAt;
    const tolerance = Math.max(
      MIN_TRANSITION_GAP_TOLERANCE_MS,
      targetGap * TRANSITION_GAP_TOLERANCE_RATIO,
    );
    const candidates: number[] = [];
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < transitions.count; index += 1) {
      const distance = Math.abs(data.readInt16LE(index * stride) / CSD4CA_MODEL.transitionQuantization[0] - targetGap);
      if (distance <= tolerance) candidates.push(index);
      if (distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    }
    const selectedIndex = candidates.length > 0
      ? candidates[Math.floor(next() * candidates.length)]!
      : closestIndex;
    const offset = selectedIndex * stride;
    const transition = CSD4CA_MODEL.transitionQuantization.map(
      (quantization, index) => data.readInt16LE(offset + index * 2) / quantization,
    ) as [number, number, number, number, number];
    session.gravity = [
      session.gravity[0] + transition[1],
      session.gravity[1] + transition[2],
      session.gravity[2] + transition[3],
    ];
    session.heading += transition[4];
  }
  session.swipeCount += 1;
  session.lastSwipeAt = elapsedMs;
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

function sample(group: InteractionModelGroup, next: Random): GestureSample {
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
  session: InteractionSession,
): void {
  const interval = Math.max(1, Math.round(duration / (CSD4CA_MODEL.frames - 1)));
  const accelerations = Array.from(
    { length: CSD4CA_MODEL.frames },
    (_, index) => frameTriple(values, index, CHANNEL.acceleration),
  );
  // Quantized PCA reconstruction can shift the median; keep this stream dynamic-only.
  const accelerationCenter = [0, 1, 2].map((axis) => median(
    accelerations.map((acceleration) => acceleration[axis]!),
  ));
  const headings = Array.from({ length: CSD4CA_MODEL.frames }, (_, index) => Math.atan2(
    frameValue(values, index, CHANNEL.orientationSinAlpha),
    frameValue(values, index, CHANNEL.orientationCosAlpha),
  ) * 180 / Math.PI);
  const headingCenter = Math.atan2(
    headings.reduce((sum, heading) => sum + Math.sin(heading * Math.PI / 180), 0),
    headings.reduce((sum, heading) => sum + Math.cos(heading * Math.PI / 180), 0),
  ) * 180 / Math.PI;
  for (let index = 0; index < CSD4CA_MODEL.frames; index += 1) {
    const at = Math.round(start + duration * index / (CSD4CA_MODEL.frames - 1));
    const acceleration = accelerations[index]!.map(
      (value, axis) => round(value - accelerationCenter[axis]!),
    ) as [number, number, number];
    const gravity = acceleration.map(
      (value, axis) => round(value + session.gravity[axis]!),
    ) as [number, number, number];
    frames.push(Object.freeze({
      kind: 'motion',
      at,
      acceleration,
      gravity,
      rotation: frameTriple(values, index, CHANNEL.rotation),
      interval,
    } satisfies MotionFrame));
    const relativeAlpha = headings[index]! - headingCenter;
    const alpha = relativeAlpha + session.heading;
    session.alphaReference ??= alpha;
    frames.push(Object.freeze({
      kind: 'orientation',
      at,
      alpha: round((alpha - session.alphaReference + 360) % 360, 1),
      beta: round(Math.atan2(gravity[1], gravity[2]) * 180 / Math.PI, 1),
      gamma: round(Math.atan2(-gravity[0], Math.hypot(gravity[1], gravity[2])) * 180 / Math.PI, 1),
    } satisfies OrientationFrame));
  }
}

function synthesizeSwipe(session: InteractionSession, next: Random, elapsedMs: number): InteractionFrame[] {
  advanceSessionPose(session, next, elapsedMs);
  const { touchDuration, sensorStartOffset, sensorDuration, values } = sample(session.group, next);
  const frames: InteractionFrame[] = [];
  const programStart = Math.min(0, sensorStartOffset);
  const touchStart = -programStart;
  const sensorStart = sensorStartOffset - programStart;
  for (let index = 0; index < CSD4CA_MODEL.frames; index += 1) {
    const at = Math.round(touchStart + touchDuration * index / (CSD4CA_MODEL.frames - 1));
    frames.push(createTouchFrame(values, index, touchPhase(index), at));
  }
  appendSensorFrames(frames, values, sensorStart, sensorDuration, session);
  frames.sort((left, right) => left.at - right.at);
  return frames;
}

function synthesizeTap(session: InteractionSession, next: Random): InteractionFrame[] {
  // CSD4CA has no taps; retain only its captured contact-start marginal.
  const { values } = sample(session.group, next);
  const duration = Math.round(70 + next() * 60);
  return [
    createTouchFrame(values, 0, 'start', 0),
    createTouchFrame(values, 0, 'end', duration),
  ];
}

export function synthesizeInteraction(
  recipe: InteractionRecipe,
  session: InteractionSession,
  sequence: number,
  elapsedMs: number,
): readonly InteractionFrame[] {
  const next = createRandom(hashSeed(`${session.seed}\u0000${sequence}\u0000${recipe}`));
  switch (recipe) {
    case 'swipe':
      return Object.freeze(synthesizeSwipe(session, next, elapsedMs));
    case 'tap':
      return Object.freeze(synthesizeTap(session, next));
  }
}
