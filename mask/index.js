/**
 * 反检测原语(横切关注点)。所有 patch 经这些原语改造环境,反检测逻辑收敛于此一层。
 * 对照 sdenv-extend:fn/wrap←setFuncNative、hook←wrapFunc、tag←setObjName、iface←getNativeProto、boot←_setFuncInit。
 *
 * 两点关键改进:
 *  1. WeakSet 标记(非按函数名匹配),避免同名误伤。
 *  2. 跨 realm 身份:产物 [[Prototype]] reparent 到 window intrinsic,使 instanceof/constructor 落在 window 内建上。
 *
 * 函数 native 化家族(分工权威,各函数不再重述):
 *   fn       —— 新函数:换 toString、校正 name/length、reparent。
 *   native   —— = dropOwnToString ∘ fn:装 native 方法/getter 的统一入口。
 *   wrap     —— 已存在方法:只改外观(消 toString 源码泄漏)。
 *   hook     —— 替换已有方法:factory(orig)→新实现,继承 arity/属性名。
 *   wrapAccessor —— 同 wrap,作用于 accessor get/set。
 *   deproto  —— 同 wrap,但换函数对象以消残留 .prototype(根因见该函数)。
 * 共用尾 dropOwnToString:reparent 落地则删 own toString(真 native 无);未落地保留兜底。
 *
 * 背景分析见 docs/spec/mask-primitive-consolidation.md(本头注是活的权威分工)。
 *
 * ━━ 文件结构 ━━
 *  §1 函数伪装      fn / native / dropOwnToString / wrap / hook / wrapAccessor / deproto
 *  §2 基础设施      adopt / reorderOwnKeys / tag / ctorProtos / brandless / ifaceRegistry
 *  §3 接口制造      iface / ctorIface / singleton / method(s) / accessor(s) / mixin /
 *                   instAccessor(s) / eventHandler / reflectAccessor
 *  §4 引导 & 工具   boot / promise / pending
 */

const origToString = Function.prototype.toString;

export function createMask(window) {
  const WObject = window.Object;
  const WArray = window.Array;
  const WFunctionProto = window.Function.prototype;

  const masked = new WeakSet();

  // ── §1 函数伪装 ─────────────────────────────────────────────────────────────

  const nativeToString = function toString() {
    if (masked.has(this)) {
      return `function ${this.name || ''}() { [native code] }`;
    }
    return origToString.call(this);
  };

  // ── §2 基础设施(跨 realm / 键序 / 登记表) ──────────────────────────────────

  /** 对象/数组 reparent 到 window intrinsic 原型(跨 realm 身份对齐)。 */
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

  /** 函数 native 化:伪装 toString、校正 name/length、reparent 到 window.Function(见头注家族分工)。 */
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

  /** fn() 共用收尾:reparent 落地则删 own toString(见头注)。 */
  function dropOwnToString(func) {
    if (Object.getPrototypeOf(func) === WFunctionProto) delete func.toString;
    return func;
  }

  /** = dropOwnToString ∘ fn(见头注)。 */
  function native(impl, name, len) {
    return dropOwnToString(fn(impl, name, len));
  }

  /** 已存在方法原地 native 化(见头注)。真 intrinsic / 已 masked 自动跳过;不动 .prototype(见 deproto)。 */
  function wrap(target, name, len) {
    const func = target == null ? undefined : target[name];
    if (typeof func !== 'function') return undefined;
    if (masked.has(func)) return func;                            // 已 wrap,幂等跳过
    if (origToString.call(func).includes('[native code]')) return func; // 真 intrinsic,本就 native,不动
    dropOwnToString(fn(func, name, len));                         // name←属性名、length、masked、reparent;落地删 own toString
    return func;
  }

  /** 行为替换(见头注):factory(orig)→新实现,length←orig arity,描述符 flags 沿用。 */
  function hook(target, name, factory) {
    const orig = target == null ? undefined : target[name];
    if (typeof orig !== 'function') return undefined;
    const impl = factory(orig);
    if (typeof impl !== 'function') return undefined;
    dropOwnToString(fn(impl, name, orig.length));                 // length←原 arity(非 factory 形参数)
    const od = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, od ? { ...od, value: impl } : { value: impl, writable: true, configurable: true });
    return impl;
  }

  /** 已存在访问器 get/set 原地 native 化(见头注)。name/len 已对故不传;引用不变无需重装描述符。 */
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

  /**
   * 消残留 .prototype:用无 .prototype 的 callable 替换函数对象(见头注)。
   * 根因:jsdom 普通 function declaration 的 .prototype non-configurable 删不掉,残留即 tell。
   * bindTo 给定 → orig.bind(singleton receiver);省略 → concise-method forwarder(转发 this)。
   */
  function deproto(target, name, len, bindTo) {
    const orig = target == null ? undefined : target[name];
    if (typeof orig !== 'function') return undefined;
    if (masked.has(orig)) return orig;                               // 已处理,幂等
    const d = Object.getOwnPropertyDescriptor(target, name);
    if (!d || !d.configurable || !('value' in d)) return undefined;  // 不可替换 → 不破坏,跳过
    const repl = bindTo !== undefined
      ? orig.bind(bindTo)
      : ({ [name](...a) { return orig.apply(this, a); } })[name];
    dropOwnToString(fn(repl, name, typeof len === 'number' ? len : orig.length));
    Object.defineProperty(target, name, { ...d, value: repl });
    return repl;
  }

  /**
   * 按 order 重排 target own 字符串键为真机(Blink)序。
   * 根因:own 字符串键枚举序 = 插入序,jsdom 序 ≠ Blink IDL 序。修法:删全部 configurable 键 → 按 order 重建。
   * 键集漂移时经宿主 console 告警(不静默错位)。
   */
  function reorderOwnKeys(target, order) {
    const names = Object.getOwnPropertyNames(target);
    const want = new Set(order);
    const present = new Set(names);
    const missing = order.filter((k) => !present.has(k)); // order 有、target 无 → 跳过
    const extra = names.filter((k) => !want.has(k));       // target 有、order 无 → append 尾部
    if (missing.length || extra.length) {
      try {
        console.warn(`[mask.reorderOwnKeys] ${target[Symbol.toStringTag] || '?'} own 键集合漂移`
          + `:order 缺 [${extra.join(',')}],order 多 [${missing.join(',')}]`);
      } catch { /* noop */ }
    }
    const desc = new Map(names.map((k) => [k, Object.getOwnPropertyDescriptor(target, k)]));
    for (const k of names) if (desc.get(k).configurable) delete target[k];
    for (const k of order.filter((k) => present.has(k)).concat(extra)) {
      Object.defineProperty(target, k, desc.get(k));
    }
    return target;
  }

  /** 对象类型标签:Object.prototype.toString.call(obj) → [object Name]。 */
  function tag(obj, name) {
    Object.defineProperty(obj, Symbol.toStringTag, {
      value: name, writable: false, configurable: true, enumerable: false,
    });
    return obj;
  }

  // ── §3 接口制造(iface / 方法 / 访问器) ──────────────────────────────────────

  // ctorProtos 登记表:finalizeIfaces() 把 constructor own 键挪到末位(真机 WebIDL 恒在末位)。
  // 只纠 constructor 位置;非 constructor 键仍为插入序 —— 完整键序保真留长期。
  const ctorProtos = new Set();
  function markCtorProto(proto) { if (proto && typeof proto === 'object') ctorProtos.add(proto); return proto; }
  function finalizeIfaces() {
    for (const proto of ctorProtos) {
      const d = Object.getOwnPropertyDescriptor(proto, 'constructor');
      if (!d || !d.configurable) continue;
      delete proto.constructor;
      Object.defineProperty(proto, 'constructor', d); // 重定义 → 落到 own 字符串键插入序末位(Symbol 键恒在其后,不影响)
    }
  }

  // brandless 登记表:mask 造接口实例无 jsdom EventTarget slot → 方法调用抛 brand-check。
  // patch/eventtarget 据本表 short-circuit。按 proto 登记(非枚举实例)→ 运行期 new 的壳也自动覆盖。
  const brandlessProtos = new Set();
  function markBrandless(proto) { if (proto && typeof proto === 'object') brandlessProtos.add(proto); return proto; }
  function setParent(proto, parent) {
    Object.setPrototypeOf(proto, parent);
    if (parent === window.EventTarget.prototype) markBrandless(proto);
  }
  /** 接到 EventTarget.prototype 并登记 brandless。 */
  function eventTargetProto(proto) { setParent(proto, window.EventTarget.prototype); return proto; }
  /** obj 是否 brandless EventTarget(供 patch/eventtarget short-circuit)。 */
  function isBrandlessEventTarget(obj) {
    const ETP = window.EventTarget.prototype;
    for (let p = obj == null ? null : Object.getPrototypeOf(obj); p && p !== ETP; p = Object.getPrototypeOf(p)) {
      if (brandlessProtos.has(p)) return true;
    }
    return false;
  }

  /** 伪造内部接口类:new 抛 Illegal constructor,注册到 window。返回 { ctor, proto, create }。 */
  const ifaceRegistry = new Map();
  function iface(name, props = {}) {
    // 重名守卫:复用首注册(幂等)+ 告警。
    if (ifaceRegistry.has(name)) {
      try { console.warn(`[mask.iface] 重复注册 window.${name},复用首注册(检查是否两 patch 抢注)`); } catch { /* noop */ }
      return ifaceRegistry.get(name);
    }
    // window-realm TypeError + Failed to construct 前缀(真机[实测]Blink 形态;stack 首行剥前缀由 patch/stack 复刻)。
    const ctor = fn(function () { throw new window.TypeError(`Failed to construct '${name}': Illegal constructor`); }, name);
    const proto = adopt(tag({ ...props }, name)); // proto 链落在 window.Object.prototype
    ctor.prototype = proto;
    Object.defineProperty(proto, 'constructor', { value: ctor, configurable: true, enumerable: false });
    Object.defineProperty(window, name, { value: ctor, writable: true, configurable: true, enumerable: false });
    markCtorProto(proto);
    const create = (extra = {}) => Object.assign(Object.create(proto), extra);
    const reg = { ctor, proto, create };
    ifaceRegistry.set(name, reg);
    return reg;
  }

  /** iface 的可构造对偶:无 new 才抛,带 new 则 init(self, args)。opts = { parent?, methods?, accessors?, eventHandlers?, statics?, props? }。 */
  function ctorIface(name, len, init, opts = {}) {
    const ctor = native(function (...args) {
      if (!new.target) {
        throw new window.TypeError(`Failed to construct '${name}': `
          + 'Please use the \'new\' operator, this DOM object constructor cannot be called as a function.');
      }
      if (init) init(this, args);
    }, name, len);
    const proto = adopt(tag({ ...(opts.props || {}) }, name));
    if (opts.parent) setParent(proto, opts.parent); // parent=ETP 时自动登记 brandless
    ctor.prototype = proto;
    Object.defineProperty(proto, 'constructor', { value: ctor, configurable: true, enumerable: false });
    if (opts.methods) methods(proto, opts.methods);
    if (opts.accessors) accessors(proto, opts.accessors);
    if (opts.eventHandlers) for (const h of opts.eventHandlers) eventHandler(proto, h);
    if (opts.statics) methods(ctor, opts.statics);
    Object.defineProperty(window, name, { value: ctor, writable: true, configurable: true, enumerable: false });
    markCtorProto(proto);
    const create = (extra = {}) => Object.assign(Object.create(proto), extra);
    return { ctor, proto, create };
  }

  /** iface 用法糖:建类 + 装方法/getter + 返回单例实例。一类多实例请直接用底层 iface。 */
  function singleton(name, opts = {}) {
    const { proto, create } = iface(name);
    if (opts.parent) setParent(proto, opts.parent); // parent=ETP 时自动登记 brandless
    methods(proto, opts.methods || {});
    accessors(proto, opts.accessors || {});
    for (const h of opts.eventHandlers || []) eventHandler(proto, h);
    return create(opts.props || {});
  }

  /** 装 native data 方法(真机 enumerable 方法形态)。methods=批量 { name: [len, impl] }。 */
  function method(target, name, len, impl) {
    Object.defineProperty(target, name, {
      value: native(impl, name, len), writable: true, enumerable: true, configurable: true,
    });
    return target;
  }
  function methods(target, table) {
    for (const [name, [len, impl]] of Object.entries(table)) method(target, name, len, impl);
    return target;
  }

  /** 装 native accessor getter(返回值自动 adopt)。accessor=自身;accessors=批量;mixin=装在原型上。 */
  function accessor(target, name, getValue) {
    Object.defineProperty(target, name, {
      get: native(() => adopt(getValue()), `get ${name}`), enumerable: true, configurable: true,
    });
    return target;
  }
  function accessors(target, table) {
    for (const [name, getValue] of Object.entries(table)) accessor(target, name, getValue);
    return target;
  }
  function mixin(target, getters) {
    const proto = Object.getPrototypeOf(target) || target;
    for (const [key, getValue] of Object.entries(getters)) {
      try { accessor(proto, key, getValue); } catch { accessor(target, key, getValue); }
    }
    return target;
  }

  /**
   * 实例态 accessor:getter 以 this=实例 调用,装在共享 prototype 上。区别 accessor:读 this + 不自动 adopt。
   * 经 get-syntax forwarder 造 getter(无 own .prototype,根因详见 reflectAccessor)。
   */
  function instAccessor(target, name, getter) {
    const g = Object.getOwnPropertyDescriptor(
      { get [name]() { return getter.call(this); } }, name,
    ).get;
    Object.defineProperty(target, name, {
      get: native(g, `get ${name}`, 0), enumerable: true, configurable: true,
    });
    return target;
  }
  function instAccessors(target, table) {
    for (const [name, getter] of Object.entries(table)) instAccessor(target, name, getter);
    return target;
  }

  /** 可写 on* 事件处理器(get+set,默认 null,per-instance 存储)。委托 reflectAccessor。 */
  function eventHandler(target, name) {
    return reflectAccessor(target, name, () => null, true, null);
  }

  /**
   * 可写反射 IDL 属性(get+set,非 null 默认 + per-instance 回写)。区别 eventHandler:默认是具体类型值
   * (adoptedStyleSheets→数组 / innerText→string / designMode→'off'),null 默认会在页面 init 正常使用时
   * 抛或成值 tell。get/set 经 get-/set-syntax(无 own .prototype + 可绑 this)。
   * 回写:per-property WeakMap 存(非实例 own 槽,免破坏"空实例"不变量)。
   * coerce:crasher 子集必给(存前保型,防不兼容值入存后 .trim()/for...of 崩)。
   * writable 三态:true=WeakMap 存 / false=no-op set(readonly) / 函数=[PutForwards] 自定义 setter。
   */
  function reflectAccessor(target, name, getDefault, writable = true, coerce = null) {
    const written = new WeakMap();
    const getter = Object.getOwnPropertyDescriptor(
      { get [name]() { return written.has(this) ? written.get(this) : adopt(getDefault.call(this)); } }, name,
    ).get;
    const setter = typeof writable === 'function'
      ? Object.getOwnPropertyDescriptor({ set [name](v) { writable.call(this, v); } }, name).set
      : writable
        ? Object.getOwnPropertyDescriptor({ set [name](v) { written.set(this, coerce ? coerce(v) : v); } }, name).set
        : () => {};
    Object.defineProperty(target, name, {
      get: native(getter, `get ${name}`, 0),
      set: native(setter, `set ${name}`, 1),
      enumerable: true, configurable: true,
    });
    return target;
  }

  // ── §4 引导 & 工具 ──────────────────────────────────────────────────────────

  /** 全局装一次:覆盖 window.Function.prototype.toString。 */
  function boot() {
    fn(nativeToString, 'toString');
    try {
      window.Function.prototype.toString = nativeToString;
    } catch {
      /* per-func own toString 已兜底 */
    }
  }

  /** getContext 单一分发:type→factory 注册表,首次注册时自动 hook HTMLCanvasElement.prototype.getContext。 */
  const ctxFactories = new Map();
  let ctxHooked = false;
  function registerContext(type, factory) {
    ctxFactories.set(type, factory);
    if (!ctxHooked) {
      ctxHooked = true;
      hook(window.HTMLCanvasElement.prototype, 'getContext', (orig) => function getContext(type, attrs) {
        const f = ctxFactories.get(type);
        return f ? f(this, type, attrs) : orig.call(this, type, attrs);
      });
    }
  }

  /** window-realm Promise 壳:promise(v)=resolve / pending()=永久挂起(不 resolve 给假数据也不 reject)。 */
  const promise = (v) => window.Promise.resolve(v);
  const pending = () => new window.Promise(() => {});

  return {
    fn, native, dropOwnToString, wrap, wrapAccessor, deproto, hook, tag,
    iface, ctorIface, singleton, method, methods, accessor, accessors, instAccessor, instAccessors, eventHandler, reflectAccessor, mixin, adopt, boot,
    promise, pending, reorderOwnKeys, markCtorProto, finalizeIfaces, eventTargetProto, isBrandlessEventTarget, registerContext,
  };
}
