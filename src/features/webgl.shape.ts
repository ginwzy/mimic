import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { Shape } from '../core/types.js';
import { canvasShape } from './canvas.shape.js';
import { operations } from './webgl.js';

export function webglShape(input: Shape): Shape {
  const shape = canvasShape(input);
  if (shape.features.includes('webgl')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'webgl'].sort(),
    ops: [...shape.ops, ...operations()],
    support: {
      ...shape.support,
      'webgl.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'webgl.api': 'shape-only',
    },
  }));
}
