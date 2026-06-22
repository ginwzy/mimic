/**
 * 反检测原语(横切关注点)。
 * 所有 patch 通过这些原语改造环境,反检测逻辑收敛于此一层。
 *
 * 对照 sdenv-extend:
 *   fn    ← setFuncNative
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
      const get = fn(function () { return adopt(getValue()); }, `get ${key}`);
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

  return { fn, tag, iface, mixin, adopt, boot };
}
