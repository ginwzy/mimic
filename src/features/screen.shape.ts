import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './screen.compile.js';

export function screenShape(shape: Shape): Shape {
  return extendShape(shape, 'screen', operations(), {
    'screen.shape': shapeSupport(shape),
    'screen.api': 'emulated',
  });
}
