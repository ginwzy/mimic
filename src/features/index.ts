/** Feature/Driver catalog for execute. Shape compile is `./shape.ts`. */
import type { Drivers } from '../engine/types.js';
import type { Feature } from '../shape/types.js';
import { audioDriver, audioFeature } from './audio.js';
import { canvasDriver, canvasFeature } from './canvas.js';
import { chromeDriver, chromeFeature, touchFeature } from './chrome.js';
import { domDriver, domFeature } from './dom.js';
import { globalsDriver, globalsFeature } from './globals.js';
import { navDriver, navFeature } from './nav.js';
import { netDriver, netFeature } from './net.js';
import { perfDriver, perfFeature } from './perf.js';
import { pluginsDriver, pluginsFeature } from './plugins.js';
import { screenDriver, screenFeature } from './screen.js';
import { timeDriver, timeFeature } from './time.js';
import { traceDriver, traceFeature } from './trace.js';
import { uaDriver, uaFeature } from './ua.js';
import { viewDriver, viewFeature } from './view.js';
import { webglDriver, webglFeature } from './webgl.js';

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
  dom: domDriver,
  net: netDriver,
  time: timeDriver,
  perf: perfDriver,
  canvas: canvasDriver,
  webgl: webglDriver,
  audio: audioDriver,
  trace: traceDriver,
});
