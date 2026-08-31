import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { screenShape } from './screen.shape.js';
import { operations } from './touch.js';

export function touchShape(input: Shape): Shape {
  const shape = screenShape(input);
  return extendShape(shape, 'touch', operations(shape), {
    'touch.shape': shapeSupport(shape),
  });
}
