import type { Drivers } from '../engine/types.js';
import { audioDriver } from './audio.driver.js';
import { canvasDriver } from './canvas.driver.js';
import { chromeDriver } from './chrome.driver.js';
import { domDriver } from './dom.driver.js';
import { globalsDriver } from './globals.driver.js';
import { navDriver } from './nav.driver.js';
import { netDriver } from './net.driver.js';
import { perfDriver } from './perf.driver.js';
import { pluginsDriver } from './plugins.driver.js';
import { screenDriver } from './screen.driver.js';
import { timeDriver } from './time.driver.js';
import { touchDriver } from './touch.driver.js';
import { traceDriver } from './trace.driver.js';
import { uaDriver } from './ua.driver.js';
import { viewDriver } from './view.driver.js';
import { webglDriver } from './webgl.driver.js';

export const drivers: Drivers = Object.freeze({
  view: viewDriver, screen: screenDriver, chrome: chromeDriver, nav: navDriver,
  ua: uaDriver, plugins: pluginsDriver, globals: globalsDriver, dom: domDriver,
  net: netDriver, time: timeDriver, perf: perfDriver, canvas: canvasDriver,
  webgl: webglDriver, audio: audioDriver, trace: traceDriver, touch: touchDriver,
});
