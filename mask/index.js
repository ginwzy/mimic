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
   * wrap / hook / wrapAccessor / mixin 共用此尾;新建独立全局函数(patch/globals 的 window 方法壳)
   * 亦经此尾,故导出 —— 避免"删 own toString"这一微妙判定被复制后漂移。
   */
  function dropOwnToString(func) {
    if (Object.getPrototypeOf(func) === WFunctionProto) delete func.toString;
    return func;
  }

  /**
   * 把一个**新建**函数对象 native 化(= dropOwnToString ∘ fn):换 toString 外观、校正 name/length、
   * reparent 到 window.Function 身份、落地后删 own toString。是 patch 装 native 方法/getter 的统一入口。
   * 与 wrap 的分工:wrap 接管"对象上已存在的具名函数"(masked 幂等守卫 + 跳过真 intrinsic);native 接管
   * "显式传入的壳/构造器函数",无需守卫。原先各 patch 自定义同名 helper 复制此组合(navigator/globals/
   * uadata/plugins 各一份),现收敛于此 —— 与当初导出 dropOwnToString 同理,免"微妙判定被复制后漂移"。
   */
  function native(impl, name, len) {
    return dropOwnToString(fn(impl, name, len));
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
   * 消除 accessor.get/set.toStringNative=false 的实现源码泄漏。注:不动 .prototype(mixin getter 残留属另一类泄漏,单独清理)。
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

  /**
   * 消除"对象上具名普通函数"残留的 .prototype own 属性(对照 wrap 只改外观,deproto 还换函数对象)。
   * 根因:jsdom 把 atob/setTimeout/XPath 等实现为普通 function declaration —— 其 prototype 描述符
   * non-configurable,delete / 赋值都删不掉,Proxy 受 non-configurable 不变式约束亦无法隐藏(连 has
   * trap 都不能返回 false)。真机 native 方法无 own .prototype,残留即 tell。唯一出路:用本就无 .prototype
   * 的 callable 整体替换函数对象,再过 fn() 掩码。据 receiver 形态择制造法:
   *   bindTo 给定(singleton receiver,如 window 自有 helper)→ orig.bind(bindTo):无 .prototype、
   *     自动继承 length、不在错误栈注入包装帧。jsdom 实现 this-宽容(实测错 this 不抛),绑定固定
   *     receiver 不破坏正常调用。
   *   bindTo 省略(per-instance receiver,如 Document.prototype 方法,this 随实例变)→ concise-method
   *     forwarder:转发 this(故能跨实例工作),其 length 砸为 0、须由 fn() 显式校正。
   * 两路皆经 fn():name←属性名(bound 的 'bound X' 一并校正)、length 校正、masked/toString native、
   * reparent + 删 own toString。choose 名集见调用方(patch/window 的 NO_PROTOTYPE,据 L2 基线 hasPrototype)。
   * @returns {Function|undefined}  替换后的新函数;非函数 / 描述符不可替换则 undefined(不破坏原状)。
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
   * 把 target 的全部 own **字符串**键按 order 重排为真机(Blink)序,消除 getOwnPropertyNames 顺序 tell。
   * 根因:own 字符串键的枚举序 = 定义(插入)序;jsdom 建原型时的定义序 ≠ Blink IDL 序,且后续 patch 注入的
   * 键只能 append、无法插进 jsdom 原生键中间 → 整体序错(顺序可被检测器直接逐项对比,是强 tell)。redefine
   * 已存在键不改其位置,故唯一修法:抓全部描述符 → 删全部 configurable 字符串键 → 按 order 逐个重建。
   * 描述符原样回写(getter 身份 / value / flags 不变)→ 行为不变、不引入新 tell。整数索引键(若有)恒排在
   * 字符串键之前、Symbol 键恒排其后,二者均不参与 getOwnPropertyNames 比较,故只动字符串键。
   * 漂移防护:实际 own 字符串键集合 ≠ order 集合时经宿主 console(Node realm)告警 —— order 缺的键按原
   * 相对序 append 到尾部,order 多的键跳过。把"注入键集变动 / 真机版本漂移致 order 过期"暴露而非静默错位。
   * non-configurable 键不删(留原位)+ 描述符原样回写(no-op);全 configurable 的原型可达精确真机序。
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

  /**
   * 伪造内部接口类(满足 instanceof,构造即抛 Illegal constructor)。
   * 在真实浏览器是全局可见的,故注册到 window。
   * @returns {{ ctor: Function, proto: object, create: (props?:object)=>object }}
   */
  const ifaceRegistry = new Map();
  function iface(name, props = {}) {
    // 重名守卫:两个 patch 抢注同名 window 接口类会令后者静默覆盖前者(且先注册的实例 proto 身份分裂)。
    // 命中即复用首注册(幂等)并经宿主 console 告警(Node realm,非页面可见)—— 把设计冲突暴露而不崩 realm。
    if (ifaceRegistry.has(name)) {
      try { console.warn(`[mask.iface] 重复注册 window.${name},复用首注册(检查是否两 patch 抢注)`); } catch { /* noop */ }
      return ifaceRegistry.get(name);
    }
    // 抛 window-realm TypeError:页面 `catch(e){ e instanceof TypeError }`(检测器试探非法构造)须为 true —— 同
    // adopt 的跨 realm 身份契约,Node realm 的 TypeError 会令该 instanceof 为 false 而成 tell。
    const ctor = fn(function () { throw new window.TypeError('Illegal constructor'); }, name);
    const proto = adopt(tag({ ...props }, name)); // proto 链落在 window.Object.prototype
    ctor.prototype = proto;
    Object.defineProperty(proto, 'constructor', { value: ctor, configurable: true, enumerable: false });
    Object.defineProperty(window, name, { value: ctor, writable: true, configurable: true, enumerable: false });
    /** 基于该接口原型创建一个 window 身份的实例。 */
    const create = (extra = {}) => Object.assign(Object.create(proto), extra);
    const reg = { ctor, proto, create };
    ifaceRegistry.set(name, reg);
    return reg;
  }

  /**
   * iface 的常见用法糖:建接口类 + 装 native 方法/getter(可选插父原型)+ 创建单例实例并返回。
   * opts = { methods?, accessors?, props?, parent? }(methods/accessors 见下;props=实例自有数据;parent=
   * 插入的父原型如 EventTarget.prototype)。需"一类多实例"或要分别操作 proto/create 的,直接用底层 iface。
   */
  function singleton(name, opts = {}) {
    const { proto, create } = iface(name);
    if (opts.parent) Object.setPrototypeOf(proto, opts.parent);
    methods(proto, opts.methods || {});
    accessors(proto, opts.accessors || {});
    return create(opts.props || {});
  }

  /**
   * 装 native data 方法(真机 prototype 上 enumerable 方法形态:value=native fn,writable+enumerable+
   * configurable)。method=单个;methods=批量,table = { name: [len, impl] }。各 patch 原 defineMethods/
   * dataMethod 循环的收敛点 —— 想覆盖既有 jsdom 方法或挑非默认 flags 的,自行 defineProperty。
   */
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

  /**
   * 装 native accessor getter:get 为 native(箭头无 .prototype、len0、无 own toString),无 set,enumerable;
   * 返回值经 adopt 对齐 window 身份。三个层次共用同一 getter 形态(指纹三件套:原型位置 + accessor 描述符 +
   * native getter):accessor=装在 target 自身;accessors=批量;mixin=装在 target 的**原型**上(标量指纹
   * 覆盖,如 navigator.userAgent)。getValue 闭包只读闭包变量(profile/单例)、不用 this,故箭头安全。
   */
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

  /** 全局装一次:覆盖 window 的 Function.prototype.toString(纵深防御)。 */
  function boot() {
    fn(nativeToString, 'toString');
    try {
      window.Function.prototype.toString = nativeToString;
    } catch {
      /* per-func own toString 已兜底 */
    }
  }

  /**
   * window-realm Promise 壳(各 patch 的方法壳常用)。一律用 window.Promise(非宿主 Promise)对齐 realm 身份:
   *   promise(v) —— 即时 resolve 到 window-realm Promise(void→resolve 语义)。
   *   pending()  —— 永久挂起:既不 resolve 给假数据、也不 reject 触发 unhandledrejection
   *                 (用于返回复杂对象 MediaStream/BatteryManager/竞价结果 的方法壳;真机对正常请求亦 pending 至响应)。
   * 收敛于此一处,免"不 reject/不 resolve"这一不变量被各 patch 复制后漂移。resolved 值的 adopt 由调用点负责。
   */
  const promise = (v) => window.Promise.resolve(v);
  const pending = () => new window.Promise(() => {});

  return {
    fn, native, dropOwnToString, wrap, wrapAccessor, deproto, hook, tag,
    iface, singleton, method, methods, accessor, accessors, mixin, adopt, boot,
    promise, pending, reorderOwnKeys,
  };
}
