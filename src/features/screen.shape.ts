import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './screen.js';
import { viewShape } from './view.shape.js';

export function screenShape(input: Shape): Shape {
  const shape = viewShape(input);
  return extendShape(shape, 'screen', operations(), {
    'screen.shape': shapeSupport(shape),
    'screen.api': 'emulated',
  });
}
