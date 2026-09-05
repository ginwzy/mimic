import type { BuiltinFeature } from './types.js';
import { audioFeature } from './audio.compile.js';
import { canvasFeature } from './canvas.compile.js';
import { chromeFeature } from './chrome.compile.js';
import { domFeature } from './dom.compile.js';
import { globalsFeature } from './globals.compile.js';
import { navFeature } from './nav.compile.js';
import { netFeature } from './net.compile.js';
import { perfFeature } from './perf.compile.js';
import { pluginsFeature } from './plugins.compile.js';
import { screenFeature } from './screen.compile.js';
import { timeFeature } from './time.compile.js';
import { touchFeature } from './touch.compile.js';
import { traceFeature } from './trace.compile.js';
import { uaFeature } from './ua.compile.js';
import { viewFeature } from './view.compile.js';
import { webglFeature } from './webgl.compile.js';

export const features: readonly BuiltinFeature[] = Object.freeze([
  viewFeature, screenFeature, chromeFeature, touchFeature, navFeature, uaFeature,
  pluginsFeature, globalsFeature, domFeature, netFeature, timeFeature, perfFeature,
  canvasFeature, webglFeature, audioFeature, traceFeature,
]);

export const driverIds: readonly string[] = Object.freeze(features.map(feature => feature.id));
