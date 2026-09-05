import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './touch.compile.js';

export function touchShape(shape: Shape): Shape {
  return extendShape(shape, 'touch', operations(shape), {
    'touch.shape': shapeSupport(shape),
  });
}
