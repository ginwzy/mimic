import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './perf.js';

export function perfShape(input: Shape): Shape {
  return extendShape(input, 'perf', operations(), {
    'perf.shape': shapeSupport(input),
    'perf.api': 'emulated',
  });
}
