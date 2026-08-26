import type { Shape } from '../core/types.js';
import { operations } from './chrome.js';
import { extendShape, shapeSupport } from './extend.js';
import { screenShape } from './screen.shape.js';

export function chromeTouchShape(input: Shape): Shape {
  const shape = screenShape(input);
  const chrome = shape.target.host === 'chrome';
  return extendShape(shape, 'touch', operations(shape), {
    'chrome.shape': shapeSupport(shape),
    'touch.shape': shapeSupport(shape),
    'window.secure-context': 'emulated',
    ...(chrome ? { 'chrome.media-surface': 'emulated' as const } : {}),
  }, chrome ? ['chrome'] : []);
}
