/**
 * resources/probe.js —— 结构面探针与 diff 的真相源。
 *
 * 零依赖、自包含、可序列化:同一份代码两侧同源运行 ——
 *   (a) 真机 Chrome:经 collect 服务的 /probe.js 加载,window.__probe__() 回传基线;
 *   (b) Runtime:被读成文本并在目标 Realm 中执行。
 *
 * 只采"结构/形态"(name/length/native toString/own-toString/描述符 flags/原型链/类型标签),
 * 不采"身份值"(UA/platform 串)—— 那是 Profile 数据,由公共 codec 守自洽,不在结构 diff 范畴。
 *
 * 关键纪律:
 *  - 用"环境里的"Function.prototype.toString 判 native,保持检测器视角。
 *  - 快照只放 string/number/boolean/array,绝不放活引用 —— JSON.stringify 安全,跨回 Node 只过 primitive。
 *  - 每个 target 各自 try/catch,单点失败不毁整次快照。
 *
 * 与 sdenv 对照:sdenv 用一堆 *.test.js 硬断言真机值;此处把"断言"反过来做成"采集 + 逐字段 diff",
 * 真机基线是 ground truth,mimic 跑同一套探针,差异即泄漏。
 */
(function () {
  'use strict';

  var PROBE_VERSION = 1;

  // 安全引用:始终使用目标 Realm 中检测器看到的 Function.prototype.toString。
  var FToString = Function.prototype.toString;
  var OToString = Object.prototype.toString;
  var hasOwn = Object.prototype.hasOwnProperty;
  var getOwnDesc = Object.getOwnPropertyDescriptor;
  var getOwnNames = Object.getOwnPropertyNames;
  var getOwnSyms = Object.getOwnPropertySymbols;
  var getProto = Object.getPrototypeOf;

  function srcOf(fn) { try { return FToString.call(fn); } catch (e) { return ''; } }
  function isNative(fn) { return /\{\s*\[native code\]\s*\}/.test(srcOf(fn)); }
  function own(o, k) { try { return hasOwn.call(o, k); } catch (e) { return false; } }
  function tagOf(o) { try { return OToString.call(o); } catch (e) { return ''; } }
  function typeofSafe(v) { var t = typeof v; return t === 'object' ? (v === null ? 'null' : 'object') : t; }

  /** 函数形态 tell —— name/length/native/own-toString/残留 .prototype/own 键签名。 */
  function fnTell(fn) {
    var names;
    try { names = getOwnNames(fn).sort().join(','); } catch (e) { names = ''; }
    var native = isNative(fn);
    return {
      name: typeof fn.name === 'string' ? fn.name : '',
      length: typeof fn.length === 'number' ? fn.length : -1,
      toStringNative: native,
      // 仅非 native 时留源码片段(界定基线体积),用于人眼定位泄漏。
      toStringSrc: native ? '' : srcOf(fn).slice(0, 160).replace(/\s+/g, ' '),
      hasOwnToString: own(fn, 'toString'),
      hasPrototype: ('prototype' in fn),
      ownNames: names
    };
  }

  /** 原型链形状:逐级 getPrototypeOf,按构造器名打标,止于 Object.prototype / null。顺序是契约。 */
  function chainOf(o) {
    var out = [];
    var cur;
    try { cur = getProto(o); } catch (e) { return out; }
    var guard = 0;
    while (cur && guard++ < 50) {
      out.push(protoLabel(cur));
      if (cur === Object.prototype) return out;
      try { cur = getProto(cur); } catch (e) { break; }
    }
    out.push('null');
    return out;
  }

  function protoLabel(o) {
    if (o === Object.prototype) return 'Object.prototype';
    try {
      var c = o.constructor;
      if (typeof c === 'function' && c.name) return c.name + '.prototype';
    } catch (e) { /* noop */ }
    var t = tagOf(o);
    return t ? t.slice(8, -1) + '.proto?' : 'unknown';
  }

  /** 单个 own key 的描述符形态(data/accessor) + 函数/访问器 tell。 */
  function keyRecord(obj, key) {
    var d;
    try { d = getOwnDesc(obj, key); } catch (e) { return { error: 'descriptor-throw' }; }
    if (!d) return { error: 'no-descriptor' };
    if ('value' in d) {
      var rec = {
        type: 'data',
        flags: { writable: !!d.writable, enumerable: !!d.enumerable, configurable: !!d.configurable },
        valueType: typeofSafe(d.value)
      };
      if (typeof d.value === 'function') rec.fn = fnTell(d.value);
      return rec;
    }
    return {
      type: 'accessor',
      flags: { enumerable: !!d.enumerable, configurable: !!d.configurable },
      accessor: {
        get: typeof d.get === 'function' ? fnTell(d.get) : null,
        set: typeof d.set === 'function' ? fnTell(d.set) : null
      }
    };
  }

  /**
   * 类数组集合的**值级**采集 —— 有意越过 probe "只采结构不采身份值" 契约:plugins/mimeTypes 是 host 固定的
   * 不变量集(Chrome 统一 PDF viewer 后恒 5 plugin × 2 mimeType),非 per-device 身份值,故归结构 harness 守护、
   * 不归 profile.validate。`plugins.length=0` 是经典 headless tell 而结构面采不到 → 直采 length + 逐索引标量字段。
   * itemFields 由 target 显式声明,只取 primitive(非标量如 enabledPlugin 反指不列,避免环引用序列化)。
   */
  function collectionRecord(o, itemFields) {
    var length = -1;
    try { length = (typeof o.length === 'number') ? o.length : -1; } catch (e) { length = -1; }
    var items = [];
    var n = length >= 0 ? length : 0;
    for (var i = 0; i < n && i < 64; i++) {
      var el;
      try { el = o[i]; } catch (e) { el = undefined; }
      var item = {};
      for (var j = 0; j < itemFields.length; j++) {
        var f = itemFields[j];
        try {
          var v = el == null ? undefined : el[f];
          var t = typeof v;
          item[f] = (t === 'string' || t === 'number' || t === 'boolean') ? v : typeofSafe(v);
        } catch (e) { item[f] = '<throw>'; }
      }
      items.push(item);
    }
    return { length: length, items: items };
  }

  /** 对象 target:类型标签 + 原型链 + own 键(原始枚举顺序)+ 每键形态 + symbol 键。 */
  function objectRecord(o) {
    var keys = {};
    var ownKeys = [];
    try { ownKeys = getOwnNames(o); } catch (e) { ownKeys = []; }
    for (var i = 0; i < ownKeys.length; i++) {
      var k = ownKeys[i];
      if (k === 'constructor') { keys[k] = keyRecord(o, k); continue; }
      keys[k] = keyRecord(o, k);
    }
    var syms = [];
    try { syms = getOwnSyms(o).map(String); } catch (e) { syms = []; }
    return {
      tag: tagOf(o),
      protoChain: chainOf(o),
      ownKeys: ownKeys,         // 顺序即契约,不排序
      symbolKeys: syms,
      keys: keys
    };
  }

  // ── 目标清单 ──────────────────────────────────────────────────────────────
  // resolver 写成函数(在 target 全局作用域内执行;'window' 两侧皆为全局自指),
  // 缺失则 get() 抛/返 undefined → target 标 resolved:false(整体 MISSING)。
  // category: 'function' 只采单个 fnTell;'object' 采 objectRecord。
  // t1:true 标记 T1(方法 native 化)已修目标 —— harness 验收的子集。
  function F(id, get) { return { id: id, category: 'function', get: get, t1: true }; }
  function O(id, kind, get) { return { id: id, category: 'object', kind: kind, get: get }; }
  // 类数组集合 target:除 objectRecord 结构外,额外采 length 值 + 逐项 itemFields 标量(值级 diff)。
  function C(id, get, itemFields) { return { id: id, category: 'object', kind: 'collection', get: get, itemFields: itemFields }; }

  var W = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);

  var TARGETS = [
    // —— window 函数(T1 核心验证:对照 sdenv 真机表的 name/length/native)——
    F('window.alert', function () { return W.alert; }),
    F('window.atob', function () { return W.atob; }),
    F('window.blur', function () { return W.blur; }),
    F('window.btoa', function () { return W.btoa; }),
    F('window.cancelAnimationFrame', function () { return W.cancelAnimationFrame; }),
    F('window.cancelIdleCallback', function () { return W.cancelIdleCallback; }),
    F('window.captureEvents', function () { return W.captureEvents; }),
    F('window.clearInterval', function () { return W.clearInterval; }),
    F('window.clearTimeout', function () { return W.clearTimeout; }),
    F('window.close', function () { return W.close; }),
    F('window.confirm', function () { return W.confirm; }),
    F('window.createImageBitmap', function () { return W.createImageBitmap; }),
    F('window.fetch', function () { return W.fetch; }),
    F('window.find', function () { return W.find; }),
    F('window.focus', function () { return W.focus; }),
    F('window.getComputedStyle', function () { return W.getComputedStyle; }),
    F('window.getSelection', function () { return W.getSelection; }),
    F('window.matchMedia', function () { return W.matchMedia; }),
    F('window.moveBy', function () { return W.moveBy; }),
    F('window.moveTo', function () { return W.moveTo; }),
    F('window.open', function () { return W.open; }),
    F('window.postMessage', function () { return W.postMessage; }),
    F('window.print', function () { return W.print; }),
    F('window.prompt', function () { return W.prompt; }),
    F('window.queueMicrotask', function () { return W.queueMicrotask; }),
    F('window.releaseEvents', function () { return W.releaseEvents; }),
    F('window.reportError', function () { return W.reportError; }),
    F('window.requestAnimationFrame', function () { return W.requestAnimationFrame; }),
    F('window.requestIdleCallback', function () { return W.requestIdleCallback; }),
    F('window.resizeBy', function () { return W.resizeBy; }),
    F('window.resizeTo', function () { return W.resizeTo; }),
    F('window.scroll', function () { return W.scroll; }),
    F('window.scrollBy', function () { return W.scrollBy; }),
    F('window.scrollTo', function () { return W.scrollTo; }),
    F('window.setInterval', function () { return W.setInterval; }),
    F('window.setTimeout', function () { return W.setTimeout; }),
    F('window.stop', function () { return W.stop; }),
    F('window.structuredClone', function () { return W.structuredClone; }),
    F('window.webkitCancelAnimationFrame', function () { return W.webkitCancelAnimationFrame; }),
    F('window.webkitRequestAnimationFrame', function () { return W.webkitRequestAnimationFrame; }),
    F('window.getScreenDetails', function () { return W.getScreenDetails; }),
    F('window.queryLocalFonts', function () { return W.queryLocalFonts; }),
    F('window.showDirectoryPicker', function () { return W.showDirectoryPicker; }),
    F('window.showOpenFilePicker', function () { return W.showOpenFilePicker; }),
    F('window.showSaveFilePicker', function () { return W.showSaveFilePicker; }),
    F('window.webkitRequestFileSystem', function () { return W.webkitRequestFileSystem; }),
    F('window.webkitResolveLocalFileSystemURL', function () { return W.webkitResolveLocalFileSystemURL; }),
    F('window.addEventListener', function () { return W.addEventListener; }),
    F('window.dispatchEvent', function () { return W.dispatchEvent; }),
    F('window.removeEventListener', function () { return W.removeEventListener; }),

    // —— 原型/实例对象 target(供真机全量基线;采 own 键 + 描述符 + 原型链)——
    O('Navigator.prototype', 'prototype', function () { return W.Navigator.prototype; }),
    O('Screen.prototype', 'prototype', function () { return W.Screen.prototype; }),
    O('Document.prototype', 'prototype', function () { return W.Document.prototype; }),
    O('Node.prototype', 'prototype', function () { return W.Node.prototype; }),
    O('EventTarget.prototype', 'prototype', function () { return W.EventTarget.prototype; }),
    O('Element.prototype', 'prototype', function () { return W.Element.prototype; }),
    O('HTMLElement.prototype', 'prototype', function () { return W.HTMLElement.prototype; }),
    O('HTMLDivElement.prototype', 'prototype', function () { return W.HTMLDivElement.prototype; }),
    O('Event.prototype', 'prototype', function () { return W.Event.prototype; }),
    O('navigator', 'instance', function () { return W.navigator; }),
    O('screen', 'instance', function () { return W.screen; }),
    O('navigator.connection', 'instance', function () { return W.navigator.connection; }),
    O('window.chrome', 'instance', function () { return W.chrome; }),

    // —— 已补壳但此前 probe 盲区:plugins/mimeTypes(值级)+ 可 new 类/单例(结构)——
    // plugins length=0 是经典 headless tell;item 字段对照真机固定 PDF 集(name/filename/description)。
    C('navigator.plugins', function () { return W.navigator.plugins; }, ['name', 'filename', 'description', 'length']),
    C('navigator.mimeTypes', function () { return W.navigator.mimeTypes; }, ['type', 'suffixes', 'description']),
    O('navigator.userAgentData', 'instance', function () { return W.navigator.userAgentData; }),
    O('window.visualViewport', 'instance', function () { return W.visualViewport; }),
    O('window.indexedDB', 'instance', function () { return W.indexedDB; }),
    // 可 new 接口类:采构造器壳形态(name/length/native/hasPrototype);其 .prototype own 键待真机基线后再加。
    F('window.Worker', function () { return W.Worker; }),
    F('window.RTCPeerConnection', function () { return W.RTCPeerConnection; }),
    F('window.Notification', function () { return W.Notification; })
  ];

  function buildSnapshot() {
    var targets = [];
    for (var i = 0; i < TARGETS.length; i++) {
      var t = TARGETS[i];
      var rec = { id: t.id, category: t.category };
      if (t.kind) rec.kind = t.kind;
      if (t.t1) rec.t1 = true;
      var obj;
      try { obj = t.get(); } catch (e) { obj = undefined; }
      if (obj === undefined || obj === null) {
        rec.resolved = false;
        targets.push(rec);
        continue;
      }
      rec.resolved = true;
      try {
        if (t.category === 'function') {
          if (typeof obj !== 'function') { rec.resolved = false; rec.note = 'not-a-function'; }
          else rec.fn = fnTell(obj);
        } else {
          rec.tag = tagOf(obj);
          var o = objectRecord(obj);
          rec.protoChain = o.protoChain;
          rec.ownKeys = o.ownKeys;
          rec.symbolKeys = o.symbolKeys;
          rec.keys = o.keys;
          if (t.kind === 'collection') rec.collection = collectionRecord(obj, t.itemFields || []);
        }
      } catch (e) {
        rec.error = String(e && e.message || e);
      }
      targets.push(rec);
    }
    return {
      meta: { source: 'probe', probeVersion: PROBE_VERSION, complete: true },
      targets: targets
    };
  }

  // 浏览器侧暴露(统一采集页调用并回传);Node 侧读文本后 eval 触发。
  if (typeof window !== 'undefined') window.__probe__ = buildSnapshot;
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildSnapshot: buildSnapshot, PROBE_VERSION: PROBE_VERSION };
})();
