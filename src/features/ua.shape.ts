import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './ua.compile.js';

export function uaShape(shape: Shape): Shape {
  return extendShape(shape, 'ua', operations(), {
    'ua.shape': shapeSupport(shape),
    'ua.api': 'emulated',
  });
}
