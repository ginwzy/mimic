import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './globals.compile.js';

export function globalsShape(shape: Shape): Shape {
  return extendShape(shape, 'globals', operations(shape), {
    'globals.shape': shapeSupport(shape),
    'globals.api': 'shape-only',
  });
}
