import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './nav.compile.js';

export function navShape(shape: Shape): Shape {
  return extendShape(shape, 'nav', operations(), {
    'nav.shape': shapeSupport(shape),
    'nav.api': 'emulated',
  });
}
