/** Shape compile pipeline. Execute catalog is `index.ts`; workers must not import this. */
import type { Shape } from '../core/types.js';
import { audioShape } from './audio.shape.js';
import { canvasShape } from './canvas.shape.js';
import { netShape } from './net.shape.js';
import { perfShape } from './perf.shape.js';
import { timeShape } from './time.shape.js';
import { traceShape } from './trace.shape.js';
import { webglShape } from './webgl.shape.js';

export function shape(input: Shape): Shape {
  let output = netShape(input);
  output = timeShape(output);
  output = perfShape(output);
  output = canvasShape(output);
  output = webglShape(output);
  output = audioShape(output);
  return traceShape(output);
}
