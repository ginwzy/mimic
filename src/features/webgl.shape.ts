import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './webgl.compile.js';

export function webglShape(shape: Shape): Shape {
  return extendShape(shape, 'webgl', operations(), {
    'webgl.shape': shapeSupport(shape),
    'webgl.api': 'shape-only',
  });
}
