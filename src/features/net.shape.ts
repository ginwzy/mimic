import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { Shape } from '../core/types.js';
import { domShape } from './dom.shape.js';
import { operations } from './net.js';

export function netShape(input: Shape): Shape {
  const shape = domShape(input);
  if (shape.features.includes('net')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'net'].sort(),
    ops: [...shape.ops, ...operations()],
    support: {
      ...shape.support,
      'net.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'net.api': 'emulated',
    },
  }));
}
