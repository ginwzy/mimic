import type { Shape } from '../core/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './view.js';

export function viewShape(shape: Shape): Shape {
  return extendShape(shape, 'view', operations(), {
    'view.shape': shapeSupport(shape),
    'view.api': 'emulated',
  });
}
