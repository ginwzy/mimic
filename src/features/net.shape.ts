import type { Shape } from '../core/types.js';
import { domShape } from './dom.shape.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './net.js';

export function netShape(input: Shape): Shape {
  const shape = domShape(input);
  return extendShape(shape, 'net', operations(), {
    'net.shape': shapeSupport(shape),
    'net.api': 'emulated',
  });
}
