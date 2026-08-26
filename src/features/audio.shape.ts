import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { Shape } from '../core/types.js';
import { operations } from './audio.js';
import { domShape } from './dom.shape.js';

export function audioShape(input: Shape): Shape {
  const shape = domShape(input);
  if (shape.features.includes('audio')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'audio'].sort(),
    ops: [...shape.ops, ...operations()],
    support: {
      ...shape.support,
      'audio.shape': 'derived',
      // Channel buffers exist; true device audio capture is not claimed here.
      // Value sums for BMS OfflineAudio hash come from audioFeature (audio.sums).
      'audio.samples': 'shape-only',
      'audio.fingerprint': 'unsupported',
    },
  }));
}
