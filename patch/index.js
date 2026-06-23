/**
 * patch 注册表 —— pipeline 的输入。新增特性补丁在此登记即可。
 * 顺序无关:实际执行顺序由各 patch 的 `after` 依赖拓扑决定。
 */
import windowPatch from './window.js';
import stack from './stack.js';
import symbol from './symbol.js';
import navigator from './navigator.js';
import screen from './screen.js';
import chrome from './chrome.js';
import touch from './touch.js';
import canvas from './canvas.js';
import webgl from './webgl.js';
import audio from './audio.js';
import clock from './clock.js';

export const patches = [windowPatch, stack, symbol, navigator, screen, chrome, touch, canvas, webgl, audio, clock];
