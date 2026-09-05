import type { Shape } from '../core/types.js';
import { operations } from './audio.compile.js';
import { extendShape } from './extend.js';

export function audioShape(shape: Shape): Shape {
  return extendShape(shape, 'audio', operations(), {
    'audio.shape': 'derived',
    // Channel buffers exist; true device audio capture is not claimed here.
    // Value sums for BMS OfflineAudio hash come from audioFeature (audio.sums).
    'audio.samples': 'shape-only',
    'audio.fingerprint': 'unsupported',
  });
}
