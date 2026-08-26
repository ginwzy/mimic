import type { Shape } from '../core/types.js';
import { chromeTouchShape } from './chrome.shape.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './nav.js';

export function navShape(input: Shape): Shape {
  const shape = chromeTouchShape(input);
  return extendShape(shape, 'nav', operations(), {
    'nav.shape': shapeSupport(shape),
    'nav.api': 'emulated',
  });
}
