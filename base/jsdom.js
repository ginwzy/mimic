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
 * @returns {{ window: Window, context: object }} jsdom 的 window 及其内部 vm context
 *   context 供执行层用 vm.runInContext(code, context, { filename }) 运行目标脚本 ——
 *   相比 window.eval,可经 filename 把 error.stack 的帧来源对齐为页面 URL,消除 "eval at run (file://...)" 泄漏(见 patch/stack)。
 */
export function createWindow({ url = 'https://example.com/', html = '<!DOCTYPE html><html><head></head><body></body></html>' } = {}) {
  const dom = new JSDOM(html, {
    url,
    // outside-only: 不自动执行页面内 <script>(避免不可控副作用),但允许 getInternalVMContext()
    // 取得 window 的 vm context,供执行层 vm.runInContext 运行目标脚本。
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    // 静音 jsdom 的 "Not implemented" 等告警,未实现的特性由 trace 层显式上报。
    virtualConsole: new VirtualConsole(),
  });
  // getInternalVMContext 返回 window 所在的 vm context(与 window 同一全局),要求 runScripts !== undefined。
  return { window: dom.window, context: dom.getInternalVMContext() };
}
