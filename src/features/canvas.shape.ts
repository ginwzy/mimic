import type { Shape } from '../core/types.js';
import { operations } from './canvas.js';
import { domShape } from './dom.shape.js';
import { extendShape, shapeSupport } from './extend.js';

export function canvasShape(input: Shape): Shape {
  const shape = domShape(input);
  return extendShape(shape, 'canvas', operations(), {
    'canvas.shape': shapeSupport(shape),
    'canvas.2d': 'shape-only',
  });
}
