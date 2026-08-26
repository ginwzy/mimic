import type { Shape } from '../core/types.js';
import { canvasShape } from './canvas.shape.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './webgl.js';

export function webglShape(input: Shape): Shape {
  const shape = canvasShape(input);
  return extendShape(shape, 'webgl', operations(), {
    'webgl.shape': shapeSupport(shape),
    'webgl.api': 'shape-only',
  });
}
