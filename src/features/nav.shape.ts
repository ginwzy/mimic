import type { Shape } from '../core/types.js';
import { chromeShape } from './chrome.shape.js';
import { extendShape, shapeSupport } from './extend.js';
import { operations } from './nav.js';

export function navShape(input: Shape): Shape {
  const shape = chromeShape(input);
  return extendShape(shape, 'nav', operations(), {
    'nav.shape': shapeSupport(shape),
    'nav.api': 'emulated',
  });
}
