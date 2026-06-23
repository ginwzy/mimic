/**
 * 反检测原语(横切关注点)。
 * 所有 patch 通过这些原语改造环境,反检测逻辑收敛于此一层。
 *
 * 对照 sdenv-extend:
 *   fn    ← setFuncNative
 *   wrap  ← setFuncNative(对已存在具名方法,仅改外观)
 *   hook  ← wrapFunc(tools/setFunc:拦截原方法 + 改行为)
 *   tag   ← setObjName / setObjNative
 *   iface ← getNativeProto
 *   boot  ← _setFuncInit
 *
 * 两点关键改进:
 *  1. 用 WeakSet 标记被伪装函数(而非按函数名匹配),避免同名误伤。
 *  2. 跨 realm 身份:patch 跑在 Node realm,但产物要交给 window realm 的脚本检测。
 *     因此把产物的 [[Prototype]] 重定向到 window 的 intrinsic
 *     (window.Function.prototype / window.Object.prototype / window.Array.prototype),
 *     使 `x instanceof window.Object/Function/Array`、`.constructor`、intrinsic 方法
 *     全部落在 window 内建上 —— 同时保留 Node 闭包(getter 仍能读 profile 值)。
 */

const origToString = Function.prototype.toString;

export function createMask(window) {
  const WObject = window.Object;
  const WArray = window.Array;
  const WFunctionProto = window.Function.prototype;

  const masked = new WeakSet();

  const nativeToString = function toString() {
    if (masked.has(this)) {
      return `function ${this.name || ''}() { [native code] }`;
    }
    return origToString.call(this);
  };

  /** 让一个对象/数组使用 window 的 intrinsic 原型(跨 realm 身份对齐)。 */
  function adopt(v) {
    if (v === null || typeof v !== 'object') return v; // primitive 无 realm,直接安全
    try {
      if (Array.isArray(v)) Object.setPrototypeOf(v, WArray.prototype);
      else if (Object.getPrototypeOf(v) === Object.prototype) Object.setPrototypeOf(v, WObject.prototype);
    } catch {
      /* 不可扩展对象跳过 */
    }
    return v;
  }

  /** 函数 native 化:伪装 toString、校正 name/length、对齐到 window.Function 身份。 */
  function fn(func, name, len) {
    if (typeof func !== 'function') return func;
    if (typeof name === 'string') Object.defineProperty(func, 'name', { value: name, configurable: true });
    else if (typeof name === 'number') len = name;
    if (typeof len === 'number') Object.defineProperty(func, 'length', { value: len, configurable: true });
    masked.add(func);
    Object.defineProperty(func, 'toString', {
      value: nativeToString, writable: true, configurable: true, enumerable: false,
    });
    try {
      Object.setPrototypeOf(func, WFunctionProto); // → instanceof window.Function 成立
    } catch {
      /* noop */
    }
    return func;
  }

  /**
   * fn() 之后的收尾:reparent 落地(→ window.Function.prototype)则删掉 fn 写入的 own toString,
   * 回落原型链上的 nativeToString —— 真 native 方法/访问器无 own toString(从 Function.prototype 继承)。
   * reparent 未落地(setPrototypeOf 被吞)则保留 own toString 兜底,避免 toString 源码泄漏。
   * wrap / hook / wrapAccessor / mixin 共用此尾,避免"删 own toString"这一微妙判定被复制后漂移。
   */
  function dropOwnToString(func) {
    if (Object.getPrototypeOf(func) === WFunctionProto) delete func.toString;
    return func;
  }

  /**
   * 把"对象上按名已存在的方法/构造器"原地 native 化(对照 sdenv setFuncNative,但用 WeakSet 标记免同名误伤)。
   * 消除 jsdom 内置函数 toString 暴露实现源码的泄漏:window.atob.toString() → 'function atob() { [native code] }'。
   *
   * 与 fn 的分工:fn 接管"显式传入的函数对象"(新建/构造器壳);
   * wrap 接管"对象上的具名函数",自动以属性名校正 name(jsdom 的 atob 等 name 为空),并删除 own toString。
   * 真 native 化的方法**没有 own toString**(从 Function.prototype 继承),故 reparent 落地后删掉 fn 留下的 own toString,
   * 回落到原型链上的 nativeToString —— 消除"方法带 own toString"这一横扫整表面的统一 tell。
   * 若 reparent 未落地(setPrototypeOf 被吞)则保留 own toString 兜底,避免泄漏。
   *
   * 真实 intrinsic(如 window.Object,本就 native)与已 wrap 过的函数自动跳过,保持最小改造面。
   * 不动 .prototype:普通函数的 prototype 为 non-configurable,删不掉,属另一类泄漏(见独立 issue)。
   * @returns {Function|undefined}  被 native 化的函数;target[name] 非函数时 undefined。
   */
  function wrap(target, name, len) {
    const func = target == null ? undefined : target[name];
    if (typeof func !== 'function') return undefined;
    if (masked.has(func)) return func;                            // 已 wrap,幂等跳过
    if (origToString.call(func).includes('[native code]')) return func; // 真 intrinsic,本就 native,不动
    dropOwnToString(fn(func, name, len));                         // name←属性名、length、masked、own toString、reparent;落地则删 own toString
    return func;
  }

  /**
   * 行为型包裹:用"拦截原方法 + 自定义实现"替换对象上的现有方法,并 native 化外观(对照 sdenv tools/setFunc 的 wrapFunc)。
   *
   * 与 fn / wrap 的分工:
   *   fn   —— native 化"显式传入的新函数对象"(新建/构造器壳),只改外观。
   *   wrap —— native 化"对象上已存在的具名方法",只改外观、不改行为(消除 toString 源码泄漏)。
   *   hook —— 替换"对象上已存在的方法"为新行为:factory(orig) 返回新实现(闭包持有 orig),
   *           新实现继承 orig 的 arity(length)与属性名,并经 fn native 化(masked/toString/reparent)。
   *           用于"过滤/记录/回放"类拦截(如对 getOwnPropertySymbols 过滤内部 symbol、getParameter 回放采集值)。
   *
   * length 取自原方法(而非 factory 写的形参个数),避免 arity 泄漏;描述符 flags(writable/enumerable/configurable)
   * 沿用原属性,仅替换 value —— 静态方法多为 writable+configurable,普通赋值也可,但 defineProperty 保 flags 更稳。
   * @returns {Function|undefined}  新实现;target[name] 非函数时 undefined。
   */
  function hook(target, name, factory) {
    const orig = target == null ? undefined : target[name];
    if (typeof orig !== 'function') return undefined;
    const impl = factory(orig);
    if (typeof impl !== 'function') return undefined;
    dropOwnToString(fn(impl, name, orig.length));                 // name←属性名、length←原 arity、masked、own toString、reparent;落地则删 own toString
    const od = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, od ? { ...od, value: impl } : { value: impl, writable: true, configurable: true });
    return impl;
  }

  /**
   * 把对象上"已存在访问器"的 get/set 函数原地 native 化(对照 wrap,但作用于 accessor 的 get/set 而非 data 方法)。
   * jsdom 原生 accessor(webidl2js 生成)的 name 已是 'get X'/'set X'、length 已对、无 .prototype 残留,
   * 故只需 fn() 换 toString 外观 + reparent + 删 fn 写入的 own toString —— 不传 name/len(基线无 accessor.*.name/length divergence)。
   * get/set 原地改造,描述符的 get/set 引用不变,无需重装描述符。真 intrinsic / 已 masked 的自动跳过。
   * 消除 accessor.get/set.toStringNative=false 的实现源码泄漏(yvq.12)。注:不动 .prototype(mixin getter 残留属 yvq.11)。
   */
  function wrapAccessor(target, key) {
    const d = target == null ? undefined : Object.getOwnPropertyDescriptor(target, key);
    if (!d || (!d.get && !d.set)) return;
    for (const half of [d.get, d.set]) {
      if (typeof half !== 'function') continue;
      if (masked.has(half)) continue;                              // 已 native 化,幂等跳过
      if (origToString.call(half).includes('[native code]')) continue; // 真 intrinsic,本就 native,不动
      dropOwnToString(fn(half));                                   // 不传 name/len(已对)→ masked/toString/reparent + 落地删 own toString
    }
  }

  /** 对象类型标签:Object.prototype.toString.call(obj) → [object Name]。 */
  function tag(obj, name) {
    Object.defineProperty(obj, Symbol.toStringTag, {
      value: name, writable: false, configurable: true, enumerable: false,
    });
    return obj;
  }

  /**
   * 伪造内部接口类(满足 instanceof,构造即抛 Illegal constructor)。
   * 在真实浏览器是全局可见的,故注册到 window。
   * @returns {{ ctor: Function, proto: object, create: (props?:object)=>object }}
   */
  function iface(name, props = {}) {
    const ctor = fn(function () { throw new TypeError('Illegal constructor'); }, name);
    const proto = adopt(tag({ ...props }, name)); // proto 链落在 window.Object.prototype
    ctor.prototype = proto;
    Object.defineProperty(proto, 'constructor', { value: ctor, configurable: true, enumerable: false });
    Object.defineProperty(window, name, { value: ctor, writable: true, configurable: true, enumerable: false });
    /** 基于该接口原型创建一个 window 身份的实例。 */
    const create = (extra = {}) => Object.assign(Object.create(proto), extra);
    return { ctor, proto, create };
  }

  /**
   * 以"原型 getter"覆盖对象属性(而非 data property),并自动 native 化每个 getter。
   * 指纹三件套:原型位置 + accessor 描述符 + native getter;返回值经 adopt 对齐 window 身份。
   */
  function mixin(target, getters) {
    const proto = Object.getPrototypeOf(target) || target;
    for (const [key, getValue] of Object.entries(getters)) {
      const get = dropOwnToString(fn(function () { return adopt(getValue()); }, `get ${key}`)); // 删 fn 写入的 own toString(对齐 wrap/hook),消除 getter own-toString tell(yvq.12)
      const desc = { get, configurable: true, enumerable: true };
      try {
        Object.defineProperty(proto, key, desc);
      } catch {
        Object.defineProperty(target, key, desc);
      }
    }
    return target;
  }

  /** 全局装一次:覆盖 window 的 Function.prototype.toString(纵深防御)。 */
  function boot() {
    fn(nativeToString, 'toString');
    try {
      window.Function.prototype.toString = nativeToString;
    } catch {
      /* per-func own toString 已兜底 */
    }
  }

  return { fn, wrap, wrapAccessor, hook, tag, iface, mixin, adopt, boot };
}
