import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './globals.js';
import { pluginsShape } from './plugins.shape.js';

export function globalsShape(input: Shape): Shape {
  const shape = pluginsShape(input);
  return extendShape(shape, 'globals', operations(shape), {
    'globals.shape': shapeSupport(shape),
    'globals.api': 'shape-only',
  });
}
