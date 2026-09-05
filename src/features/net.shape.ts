import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './net.compile.js';

export function netShape(shape: Shape): Shape {
  return extendShape(shape, 'net', operations(), {
    'net.shape': shapeSupport(shape),
    'net.api': 'emulated',
  });
}
