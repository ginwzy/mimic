/**
 * patch/window —— 批量 native 化 window/DOM 标准方法,消除 jsdom 内置函数 toString 暴露实现源码的泄漏。
 *
 * 现状[实测]:window/DOM 方法 toString() 返回 jsdom 实现源码(且 name 为空、带 own toString),
 *   window.atob.toString()            -> function (str) { try { return atob(str); } ... Node.js DOMException ...
 *   new Event('x').stopPropagation.toString() -> stopPropagation() { const esValue = ... }
 * vmp 遍历 window/DOM 方法一测即破。根因与修法见 mask.wrap。
 *
 * 覆盖策略:jsdom 把每个 Web API 原型都以全局构造器暴露在 window 上(Event/DOMTokenList/
 * CSSStyleDeclaration/Storage/NodeList/HTMLCollection/History/Location/URL/URLSearchParams/
 * Node/EventTarget/Element/HTML*Element/Document/Text/...)。故枚举 window 上每个构造器, sweep
 * 其 prototype 链(停在 Object.prototype) —— 自动覆盖全部暴露原型, 免维护手列清单(对照 sdenv
 * browser/chrome/ 下几十个手列文件)。另从代表性实例链兜底未作为全局暴露的原型。
 *
 * 安全性:mask.wrap 只 native 化"当前在泄漏"的函数 —— 真实 ECMAScript intrinsic(Object/Array/
 * Function 等)其 prototype 方法本就 native, 自动跳过, 核心 intrinsic 不被触碰;方法与构造器一视同仁
 * (wrap 不动 .prototype, 构造器仍可 new)。
 * 不在范围:访问器(getter/setter)源码泄漏、方法残留 .prototype, 属另一类泄漏(见独立 issue)。
 */
export default {
  name: 'window',
  after: [],
  apply({ window, mask }) {
    const stop = window.Object.prototype; // 原型链上界:核心 intrinsic 不碰
    const swept = new Set();

    // 方法 arity 修正表(修复 r52:sweepOwn 调 mask.wrap 不传 len → fn() 跳过 .length 校正 → jsdom 形参个数泄漏)。
    // ground truth = L2 真机结构基线 linux-chrome-v143 的 fn.length。只列 jsdom 与真机 Chrome 不一致、经 diff 实证的方法 ——
    // jsdom 余者 arity 已与真机一致(否则会有成片 fn.length TELL),故精确修正而非全量覆盖。
    // 纪律:scroll/scrollBy/scrollTo 真机即 0(实测 jsdom 亦 0,已对),刻意不入表 —— 避免被 move/resize 族(真机 2)一刀切污染。
    // key = sweep 时计算的 owner label(window 自有 / <Ctor>.prototype),取自插桩实测的 wrap 生效点。
    const ARITY = {
      window: { moveBy: 2, moveTo: 2, resizeBy: 2, resizeTo: 2, postMessage: 1 },
      'Document.prototype': { evaluate: 2, createExpression: 1 },
    };
    const arityOf = (obj, key) => {
      const label = obj === window ? 'window' : (((obj.constructor && obj.constructor.name) || '') + '.prototype');
      const t = ARITY[label];
      return t && typeof t[key] === 'number' ? t[key] : undefined;
    };

    // 扫一个对象的自有函数属性。跳过 constructor —— 它指向类, wrap 会把其 name 误改成 'constructor'。
    const sweepOwn = (obj) => {
      if (!obj || obj === stop || swept.has(obj)) return;
      swept.add(obj);
      for (const key of Object.getOwnPropertyNames(obj)) {
        if (key === 'constructor') continue;
        const d = Object.getOwnPropertyDescriptor(obj, key);
        if (d) {
          if (typeof d.value === 'function') mask.wrap(obj, key, arityOf(obj, key)); // data 方法:len 仅校正实证 arity 偏差
          else if (d.get || d.set) mask.wrapAccessor(obj, key);                       // jsdom 原生访问器:get/set 一并 native 化(yvq.12)
        }
      }
    };

    // 沿原型链逐层扫, 停在 Object.prototype。
    const sweepChain = (start) => {
      for (let o = start; o && o !== stop; o = Object.getPrototypeOf(o)) sweepOwn(o);
    };

    // window 自有方法 + 构造器函数本身(atob/btoa/setTimeout/getComputedStyle/URL/Event/...)。
    sweepOwn(window);

    // 每个全局构造器的 prototype 链 —— 覆盖 jsdom 暴露的全部 Web API 原型。
    for (const key of Object.getOwnPropertyNames(window)) {
      let proto = null;
      try {
        const d = Object.getOwnPropertyDescriptor(window, key);
        const ctor = d && d.value;
        proto = typeof ctor === 'function' ? ctor.prototype : null;
      } catch {
        continue;
      }
      if (proto && typeof proto === 'object') sweepChain(proto);
    }

    // 兜底:从代表性实例补扫 —— 既扫实例自有方法, 又扫其原型链。
    // jsdom 有怪癖:window.location 经 window 访问器暴露, 且 assign/replace/reload 等是 location
    // 实例自有属性(不在 Location.prototype 上), 故构造器枚举与纯原型链 walk 均漏 —— 必须扫实例自有。
    const doc = window.document;
    const seeds = [
      doc, //                      Document/Node 链
      doc.documentElement, //      HTML*Element/HTMLElement/Element 链
      doc.createElement('div'), // HTMLDivElement/... 链
      doc.createTextNode(''), //   Text/CharacterData 链
      window.location, //          单例:assign/replace/reload/toString(实例自有)
      window.history, //           单例
      window.navigator, //         Navigator(方法在原型)
      window.screen,
      window.localStorage,
      window.performance,
      window.crypto,
    ];
    for (const seed of seeds) {
      if (!seed || typeof seed !== 'object') continue;
      sweepOwn(seed); // 实例自有方法(覆盖 location 怪癖)
      try {
        sweepChain(Object.getPrototypeOf(seed));
      } catch {
        /* 个别 seed 不可用则跳过 */
      }
    }
  },
};
