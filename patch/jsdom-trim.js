/**
 * patch/jsdom-trim —— 削去 jsdom 相对目标 Chrome 的"过度实现"。
 *
 * jsdom 的 DOM 面对应某一 Chromium 快照,不会逐版本等同任一具体 Chrome:升级到 29 后 Pointer Events
 * 补齐 20 个真实缺口(onpointerdown/... 桌面+移动 Chrome 皆有 ✓),但 jsdom 还实现了 onpointerrawupdate ——
 * [实测]真机 Chrome 143 桌面无此键(linux 基线 absent),而 Android WebView 138 有(android 基线 present)。
 * 按 formFactor 门控削除:desktop 删(对齐桌面 Chrome)、mobile 保留(对齐移动)—— 两真机基线皆命中。
 *
 * 此 patch 是 jsdom 版本面与目标 Chrome 差异的收敛点;后续若发现其它"jsdom 有、目标 Chrome 无"的键,
 * 据基线在此按 trait 门控削除。
 */
const DESKTOP_ABSENT = ['onpointerrawupdate'];

export default {
  name: 'jsdom-trim',
  after: ['window'],
  applies: (t) => t.formFactor === 'desktop',
  apply({ window }) {
    const protos = [
      window.Document?.prototype,
      window.HTMLElement?.prototype,
      Object.getPrototypeOf(window), // Window.prototype(GlobalEventHandlers 宿主)
    ];
    for (const proto of protos) {
      if (!proto) continue;
      for (const key of DESKTOP_ABSENT) {
        if (Object.prototype.hasOwnProperty.call(proto, key)) {
          try { delete proto[key]; } catch { /* non-configurable 则跳过 */ }
        }
      }
    }
  },
};
