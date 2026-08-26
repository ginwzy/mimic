import type { Shape } from '../core/types.js';
import { extendShape } from './extend.js';

export function traceShape(input: Shape): Shape {
  return extendShape(input, 'trace', [], { 'trace.feature': 'emulated' });
}
