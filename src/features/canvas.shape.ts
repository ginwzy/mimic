import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { Shape } from '../core/types.js';
import { operations } from './canvas.js';
import { domShape } from './dom.shape.js';

export function canvasShape(input: Shape): Shape {
  const shape = domShape(input);
  if (shape.features.includes('canvas')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'canvas'].sort(),
    ops: [...shape.ops, ...operations()],
    support: {
      ...shape.support,
      'canvas.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'canvas.2d': 'shape-only',
    },
  }));
}
