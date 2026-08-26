import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './time.js';

export function timeShape(input: Shape): Shape {
  return extendShape(input, 'time', operations(), {
    'time.shape': shapeSupport(input),
    'time.api': 'emulated',
  });
}
