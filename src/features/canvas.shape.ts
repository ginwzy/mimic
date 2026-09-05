import type { Shape } from '../core/types.js';
import { operations } from './canvas.compile.js';
import { extendShape, shapeSupport } from './extend.js';

export function canvasShape(shape: Shape): Shape {
  return extendShape(shape, 'canvas', operations(), {
    'canvas.shape': shapeSupport(shape),
    'canvas.2d': 'shape-only',
  });
}
