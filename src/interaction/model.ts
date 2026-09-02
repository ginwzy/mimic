export const INTERACTION_CHANNELS = [
  'touchX', 'touchY', 'radiusX', 'radiusY', 'force',
  'accelerationX', 'accelerationY', 'accelerationZ',
  'gravityX', 'gravityY', 'gravityZ',
  'rotationAlpha', 'rotationBeta', 'rotationGamma',
  'orientationSinAlpha', 'orientationCosAlpha', 'orientationBeta', 'orientationGamma',
] as const;

export const INTERACTION_SCALES = [
  1, 1, 0.1, 0.1, 1,
  10, 10, 10,
  10, 10, 10,
  180, 180, 180,
  1, 1, 90, 90,
] as const;

export const INTERACTION_TIMING_CHANNELS = [
  'touchLogDuration', 'sensorStartOffset', 'sensorEndOffset',
] as const;

export const INTERACTION_TIMING_SCALES = [1, 25, 25] as const;

export type InteractionScenario = 'normal' | 'walking' | 'stressful';
export type InteractionHand = 'left' | 'right';
export type InteractionDirection = 'up' | 'down' | 'left' | 'right';

export interface InteractionModelComponent {
  readonly sigma: number;
  readonly basis: readonly number[];
}

export interface InteractionModelGroup {
  readonly scenario: InteractionScenario;
  readonly hand: InteractionHand;
  readonly direction: InteractionDirection;
  readonly count: number;
  readonly timingBounds: {
    readonly touchDuration: readonly [minimum: number, maximum: number];
    readonly sensorStartOffset: readonly [minimum: number, maximum: number];
    readonly sensorEndOffset: readonly [minimum: number, maximum: number];
  };
  readonly quality: {
    readonly varianceRetained: number;
    readonly crossModalCovarianceRetained: number;
  };
  readonly mean: readonly number[];
  readonly components: readonly InteractionModelComponent[];
}

export interface InteractionModel {
  readonly schema: 2;
  readonly compiler: number;
  readonly frames: number;
  readonly stride: number;
  readonly quantization: number;
  readonly channels: typeof INTERACTION_CHANNELS;
  readonly scales: typeof INTERACTION_SCALES;
  readonly timingChannels: typeof INTERACTION_TIMING_CHANNELS;
  readonly timingScales: typeof INTERACTION_TIMING_SCALES;
  readonly calibration: {
    readonly sensorTimeScale: number;
    readonly clockCalibration: string;
    readonly minimumDurationMs: number;
    readonly maximumDurationMs: number;
    readonly maxBoundaryOffsetMs: number;
  };
  readonly source: {
    readonly name: 'CSD4CA';
    readonly doi: string;
    readonly license: 'CC-BY-4.0';
    readonly device: string;
    readonly archiveMd5: string;
    readonly files: Readonly<Record<string, string>>;
  };
  readonly groups: readonly InteractionModelGroup[];
}
