/**
 * patch 注册表 —— pipeline 的输入。新增特性补丁在此登记即可。
 * 顺序无关:实际执行顺序由各 patch 的 `after` 依赖拓扑决定。
 */
import windowPatch from './window.js';
import jsdomTrim from './jsdom-trim.js';
import globals from './globals.js';
import stack from './stack.js';
import symbol from './symbol.js';
import navigator from './navigator.js';
import uadata from './uadata.js';
import plugins from './plugins.js';
import screen from './screen.js';
import chrome from './chrome.js';
import touch from './touch.js';
import canvas from './canvas.js';
import webgl from './webgl.js';
import audio from './audio.js';
import clock from './clock.js';
import protochain from './protochain.js';

export const patches = [windowPatch, jsdomTrim, globals, stack, symbol, navigator, uadata, plugins, screen, chrome, touch, canvas, webgl, audio, clock, protochain];
