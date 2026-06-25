/**
 * patch 注册表 —— pipeline 的输入。新增特性补丁在此登记即可。
 * 执行顺序:声明了 `after` 依赖的按拓扑排在其依赖之后;无依赖的保持本数组登记序(pipeline 按数组序 visit)。
 * 故登记序仍是默认序,只有真实 `after` 依赖会覆盖它 —— 不存在的依赖名会被 pipeline 告警(非静默吞)。
 */
import windowPatch from './window.js';
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
import performance from './performance.js';
import protochain from './protochain.js';
import keyorder from './keyorder.js';

export const patches = [windowPatch, globals, stack, symbol, navigator, uadata, plugins, screen, chrome, touch, canvas, webgl, audio, clock, performance, protochain, keyorder];
