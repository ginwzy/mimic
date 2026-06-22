/**
 * 基座层 —— 唯一允许直接接触 jsdom 的文件。
 * 未来若要更换 DOM 引擎(如换成 sdenv-jsdom),只改这一处。
 */
import { JSDOM, VirtualConsole } from 'jsdom';

/**
 * 创建一个干净的浏览器 window(尚未做任何 Chrome 化 / 反检测改造)。
 * @param {object} [opts]
 * @param {string} [opts.url]  document 的初始地址
 * @param {string} [opts.html] 初始 HTML
 * @returns {Window} jsdom 的 window 对象
 */
export function createWindow({ url = 'https://example.com/', html = '<!DOCTYPE html><html><head></head><body></body></html>' } = {}) {
  const dom = new JSDOM(html, {
    url,
    // outside-only: 提供 window.eval / window.Function 用于执行目标脚本,
    // 但不自动执行页面内 <script>,避免不可控副作用。
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    // 静音 jsdom 的 "Not implemented" 等告警,未实现的特性由 trace 层显式上报。
    virtualConsole: new VirtualConsole(),
  });
  return dom.window;
}
