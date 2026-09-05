import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './plugins.compile.js';

export function pluginsShape(shape: Shape): Shape {
  return extendShape(shape, 'plugins', operations(shape), {
    'plugins.shape': shapeSupport(shape),
    'plugins.api': 'emulated',
  });
}
