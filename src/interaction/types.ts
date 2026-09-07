export type InteractionRecipe = 'swipe' | 'tap';

interface TimedFrame {
  readonly at: number;
}

export interface MotionFrame extends TimedFrame {
  readonly kind: 'motion';
  readonly acceleration: readonly [number, number, number];
  readonly gravity: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly interval: number;
}

export interface OrientationFrame extends TimedFrame {
  readonly kind: 'orientation';
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
}

export interface TouchFrame extends TimedFrame {
  readonly kind: 'touch';
  readonly phase: 'start' | 'move' | 'end';
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly force: number;
}

export type InteractionFrame = MotionFrame | OrientationFrame | TouchFrame;

export interface InteractionAction {
  readonly recipe: InteractionRecipe;
  /** Nominal capture-relative time for synthesis, independent of actual dispatch. */
  readonly plannedAtMs: number;
}

export interface InteractionPolicy {
  next(elapsedMs: number, postCount: number, latestInteractionEndAt?: number, plannedInteractionEndAt?: number): InteractionAction | null;
  isExhausted(): boolean;
}
