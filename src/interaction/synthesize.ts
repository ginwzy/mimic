import type {
  InteractionFrame,
  InteractionRecipe,
  MotionFrame,
  MouseFrame,
  OrientationFrame,
  TouchFrame,
} from './types.js';

type Random = () => number;

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

function randomBetween(next: Random, minimum: number, maximum: number): number {
  return minimum + (maximum - minimum) * next();
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function clampPosition(value: number): number {
  return Math.max(0.01, Math.min(0.99, value));
}

function synthesizeMotion(next: Random): InteractionFrame[] {
  const frames: InteractionFrame[] = [];
  let x = randomBetween(next, -0.12, 0.12);
  let y = randomBetween(next, -0.12, 0.12);
  let z = randomBetween(next, -0.08, 0.08);
  let alpha = randomBetween(next, 160, 200);
  let beta = randomBetween(next, 50, 70);
  let gamma = randomBetween(next, -5, 5);
  for (let index = 0; index < 10; index += 1) {
    x += randomBetween(next, -0.025, 0.025);
    y += randomBetween(next, -0.025, 0.025);
    z += randomBetween(next, -0.018, 0.018);
    alpha += randomBetween(next, -0.8, 0.8);
    beta += randomBetween(next, -0.5, 0.5);
    gamma += randomBetween(next, -0.35, 0.35);
    const at = index * 20;
    frames.push(Object.freeze({
      kind: 'motion',
      at,
      acceleration: [round(x), round(y), round(z)],
      gravity: [round(x + 0.02), round(y + 0.04), round(9.78 + z)],
      rotation: [round(x * 4), round(y * 4), round(z * 4)],
      interval: 20,
    } satisfies MotionFrame));
    frames.push(Object.freeze({
      kind: 'orientation',
      at,
      alpha: round(alpha, 1),
      beta: round(beta, 1),
      gamma: round(gamma, 1),
    } satisfies OrientationFrame));
  }
  return frames;
}

function synthesizeSwipe(next: Random): InteractionFrame[] {
  const frames: InteractionFrame[] = [];
  const startX = randomBetween(next, 0.44, 0.56);
  const startY = randomBetween(next, 0.68, 0.76);
  const endX = startX + randomBetween(next, -0.025, 0.025);
  const endY = randomBetween(next, 0.24, 0.34);
  const point = (index: number): readonly [number, number] => {
    const progress = index / 10;
    const eased = progress * progress * (3 - 2 * progress);
    return [
      clampPosition(startX + (endX - startX) * eased + randomBetween(next, -0.004, 0.004)),
      clampPosition(startY + (endY - startY) * eased + randomBetween(next, -0.004, 0.004)),
    ];
  };
  const start = point(0);
  frames.push(Object.freeze({ kind: 'touch', phase: 'start', at: 0, x: start[0], y: start[1] } satisfies TouchFrame));
  frames.push(Object.freeze({ kind: 'mouse', phase: 'down', at: 0, x: start[0], y: start[1] } satisfies MouseFrame));
  let last = start;
  for (let index = 1; index <= 10; index += 1) {
    last = point(index);
    const at = 40 + index * 24;
    frames.push(Object.freeze({ kind: 'touch', phase: 'move', at, x: last[0], y: last[1] } satisfies TouchFrame));
    frames.push(Object.freeze({ kind: 'mouse', phase: 'move', at, x: last[0], y: last[1] } satisfies MouseFrame));
  }
  frames.push(Object.freeze({ kind: 'touch', phase: 'end', at: 310, x: last[0], y: last[1] } satisfies TouchFrame));
  frames.push(Object.freeze({ kind: 'mouse', phase: 'up', at: 310, x: last[0], y: last[1] } satisfies MouseFrame));
  for (let index = 1; index <= 12; index += 1) {
    frames.push(Object.freeze({
      kind: 'mouse',
      phase: 'move',
      at: 310 + index * 10,
      x: clampPosition(last[0] + randomBetween(next, -0.008, 0.008)),
      y: clampPosition(last[1] + randomBetween(next, -0.006, 0.006)),
    } satisfies MouseFrame));
  }
  return frames;
}

export function synthesizeInteraction(recipe: InteractionRecipe, seed: string, sequence: number): readonly InteractionFrame[] {
  const next = createRandom(hashSeed(`${seed}\u0000${sequence}\u0000${recipe}`));
  return Object.freeze(recipe === 'motion-burst' ? synthesizeMotion(next) : synthesizeSwipe(next));
}
