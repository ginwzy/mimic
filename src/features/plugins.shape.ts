import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './plugins.js';
import { uaShape } from './ua.shape.js';

export function pluginsShape(input: Shape): Shape {
  const shape = uaShape(input);
  return extendShape(shape, 'plugins', operations(shape), {
    'plugins.shape': shapeSupport(shape),
    'plugins.api': 'emulated',
  });
}
