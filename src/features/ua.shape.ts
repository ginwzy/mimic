import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { navShape } from './nav.shape.js';
import { operations } from './ua.js';

export function uaShape(input: Shape): Shape {
  const shape = navShape(input);
  return extendShape(shape, 'ua', operations(), {
    'ua.shape': shapeSupport(shape),
    'ua.api': 'emulated',
  });
}
