/**
 * harness/whitelist.js —— 已知可接受 divergence 规则(把已知未修项从 fatal 集合降级)。
 *
 * 每条规则 = 对一个 diff entry 的谓词 → 命中即标 whitelist,不计入 gate 失败。
 * 规则即数据:每条规则带一个 issue 锚点(见各规则 issue 字段),指向一项尚未完成的清理任务 ——
 * 该任务修复后删掉对应规则,即可让 gate 重新守住它。
 *
 * 验收口径:"T1 已修目标应零 divergence 或仅落白名单"。下列即"仅落白名单"的那部分 ——
 * 涵盖 jsdom 缺对象覆盖缺口 / webidl 内部 symbol 泄漏等已知未尽项。
 */

/**
 * @typedef {object} DiffEntry
 * @property {string} targetId
 * @property {string|null} key
 * @property {string} field   如 'fn.hasPrototype' / 'fn.length' / 'resolved'
 * @property {string} bucket  TELL | MISSING | EXTRA | INFO
 * @property {*} baseline
 * @property {*} mimic
 */

/** @type {Array<{issue:string, reason:string, match:(e:DiffEntry)=>boolean}>} */
export const RULES = [
  // 当前为空:此前所有降级项均已在各自 patch 修复,gate 现直接守住它们、无任何豁免。规则即数据(见模块头):
  // 锚定 issue 修复后即删本规则,gate 重新守住。已删规则及其落地修复(留作"为何 gate 现无豁免"的轨迹):
  //   · 方法/访问器残留 .prototype + getter own toString —— patch/window sweep 经 mask.deproto(无-prototype
  //     callable 替换 jsdom 普通函数声明)+ mask.wrapAccessor + mask.mixin/instAccessor 的 get-syntax/箭头 getter 消除。
  //   · DOM 原型(Document/Element/HTMLElement/EventTarget.prototype)缺方法/访问器 MISSING —— patch/domproto 据
  //     真机基线补齐 + keyorder per-host 重排键序,MISSING 清零;原一刀切 MISSING 兜底拆为 per-target 锚点后亦删。
  //   · Navigator.prototype secure-context 缺键 + 各 Web API 函数 MISSING —— patch/navigator + patch/globals 据两
  //     基线 host 门控补齐(chrome 全集 ⊃ webview 子集,contacts 移动端专属),MISSING 清零。
  //   · webidl2js 内部 Symbol(ctorRegistrySymbol 等)EXTRA —— 反射层 getOwnPropertySymbols 过滤消除(实测 0 命中)。
  //   · 实例标准扩展键 window.chrome(loadTimes/csi/app)+ Screen(availLeft/availTop/orientation)—— patch 补齐。
  //     残留 Screen onchange/isExtended 属 ownKeys 键序轴(非缺键),归 keyorder 轴、MISSING 非阻断,刻意不在此白名单。
  //   · userAgentData EXTRA(非 secure-context 基线缺陷)—— 两基线经 secure context 重采后已含,规则失配删。
];

/**
 * 对一个 diff entry 求白名单命中,返回命中的 issue 标签或 null。
 * @param {DiffEntry} entry
 * @returns {string|null}
 */
export function classify(entry) {
  for (const rule of RULES) {
    try {
      if (rule.match(entry)) return rule.issue;
    } catch {
      /* 规则谓词异常视为未命中 */
    }
  }
  return null;
}
