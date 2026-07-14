import type { Shape } from '../core/types.js';
import type { Drivers } from '../engine/types.js';
import type { Feature } from '../shape/types.js';
import { audioDriver, audioFeature, audioShape } from './audio.js';
import { canvasDriver, canvasFeature, canvasShape } from './canvas.js';
import { chromeDriver, chromeFeature, touchFeature } from './chrome.js';
import { domFeature } from './dom.js';
import { globalsDriver, globalsFeature } from './globals.js';
import { navDriver, navFeature } from './nav.js';
import { netDriver, netFeature, netShape } from './net.js';
import { perfDriver, perfFeature, perfShape } from './perf.js';
import { pluginsDriver, pluginsFeature } from './plugins.js';
import { screenDriver, screenFeature } from './screen.js';
import { timeDriver, timeFeature, timeShape } from './time.js';
import { traceDriver, traceFeature, traceShape } from './trace.js';
import { uaDriver, uaFeature } from './ua.js';
import { viewDriver, viewFeature } from './view.js';
import { webglDriver, webglFeature, webglShape } from './webgl.js';

export const features: readonly Feature[] = Object.freeze([
  viewFeature,
  screenFeature,
  chromeFeature,
  touchFeature,
  navFeature,
  uaFeature,
  pluginsFeature,
  globalsFeature,
  domFeature,
  netFeature,
  timeFeature,
  perfFeature,
  canvasFeature,
  webglFeature,
  audioFeature,
  traceFeature,
]);

export const drivers: Drivers = Object.freeze({
  view: viewDriver,
  screen: screenDriver,
  chrome: chromeDriver,
  nav: navDriver,
  ua: uaDriver,
  plugins: pluginsDriver,
  globals: globalsDriver,
  net: netDriver,
  time: timeDriver,
  perf: perfDriver,
  canvas: canvasDriver,
  webgl: webglDriver,
  audio: audioDriver,
  trace: traceDriver,
});

export function shape(input: Shape): Shape {
  let output = netShape(input);
  output = timeShape(output);
  output = perfShape(output);
  output = canvasShape(output);
  output = webglShape(output);
  output = audioShape(output);
  return traceShape(output);
}
