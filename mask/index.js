/**
 * 反检测原语(横切关注点)。所有 patch 经这些原语改造环境,反检测逻辑收敛于此一层。
 * 对照 sdenv-extend:fn/wrap←setFuncNative、hook←wrapFunc、tag←setObjName、iface←getNativeProto、boot←_setFuncInit。
 *
 * 两点关键改进:
 *  1. 用 WeakSet 标记被伪装函数(而非按函数名匹配),避免同名误伤。
 *  2. 跨 realm 身份:patch 跑在 Node realm,产物却交给 window realm 的脚本检测。故把产物 [[Prototype]]
 *     reparent 到 window intrinsic(Function/Object/Array.prototype),使 `instanceof window.*`、
 *     `.constructor`、intrinsic 方法全落在 window 内建上 —— 同时保留 Node 闭包(getter 仍能读 profile 值)。
 *
 * 函数 native 化家族(分工在此写一次,各函数不再重述):
 *   fn       —— 显式传入的新函数对象(新建/构造器壳):换 toString 外观、校正 name/length、reparent。
 *   native   —— = dropOwnToString ∘ fn:装 native 方法/getter 的统一入口。
 *   wrap     —— 对象上已存在的具名方法:只改外观不改行为(消 toString 源码泄漏),name←属性名。
 *   hook     —— 替换对象上已有方法为新行为:factory(orig)→新实现,继承 orig 的 arity/属性名。
 *   wrapAccessor —— 同 wrap,作用于 accessor 的 get/set。
 *   deproto  —— 同 wrap,但换掉函数对象以消残留 .prototype(根因见该函数)。
 * 共用尾 dropOwnToString:reparent 落地则删 fn 写入的 own toString(真 native 方法无 own toString,从
 * Function.prototype 继承);未落地则保留 own toString 兜底,避免源码泄漏。
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

  /**
   * 函数 native 化:伪装 toString、校正 name/length、对齐到 window.Function 身份。
   * 校正 length 的根因:箭头 / concise-method 实现的 .length = 书写形参个数(壳常写成无参 `()=>…`),与真机
   * native 方法的 arity 解耦 —— 故调用方传真机基线 len,这里钉死,免 jsdom/壳的形参个数泄漏。
   */
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
   * fn() 的共用收尾(见头注"函数 native 化家族")。导出而非各 patch 自实现 —— 免"删 own toString"
   * 这一微妙判定被复制后漂移。
   */
  function dropOwnToString(func) {
    if (Object.getPrototypeOf(func) === WFunctionProto) delete func.toString;
    return func;
  }

  /** = dropOwnToString ∘ fn:装 native 方法/getter 的统一入口(见头注家族分工)。 */
  function native(impl, name, len) {
    return dropOwnToString(fn(impl, name, len));
  }

  /**
   * 把"对象上按名已存在的方法/构造器"原地 native 化(见头注家族分工)。消除 jsdom 内置函数 toString 暴露
   * 实现源码的泄漏:window.atob.toString() → 'function atob() { [native code] }'。
   * 真实 intrinsic(本就 native)与已 wrap 过的函数自动跳过,保持最小改造面。
   * 不动 .prototype:普通函数的 prototype 为 non-configurable,删不掉,属另一类泄漏(deproto 处理)。
   * @returns {Function|undefined}  被 native 化的函数;target[name] 非函数时 undefined。
   */
  function wrap(target, name, len) {
    const func = target == null ? undefined : target[name];
    if (typeof func !== 'function') return undefined;
    if (masked.has(func)) return func;                            // 已 wrap,幂等跳过
    if (origToString.call(func).includes('[native code]')) return func; // 真 intrinsic,本就 native,不动
    dropOwnToString(fn(func, name, len));                         // name←属性名、length、masked、reparent;落地删 own toString
    return func;
  }

  /**
   * 行为型包裹(见头注家族分工):factory(orig) 返回新实现(闭包持有 orig),用于"过滤/记录/回放"类拦截
   * (如 getOwnPropertySymbols 滤内部 symbol、getParameter 回放采集值)。
   * length 取自原方法(非 factory 形参个数),避免 arity 泄漏;描述符 flags 沿用原属性,仅替换 value
   * (defineProperty 保 flags,比普通赋值稳)。
   * @returns {Function|undefined}  新实现;target[name] 非函数时 undefined。
   */
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

  /**
   * 把对象上"已存在访问器"的 get/set 函数原地 native 化(见头注家族分工)。消除 accessor.get/set 实现源码泄漏。
   * jsdom 原生 accessor(webidl2js 生成)name 已是 'get X'/'set X'、length 已对、无 .prototype 残留,故不传
   * name/len(基线无 accessor.*.name/length divergence);get/set 引用不变,无需重装描述符。真 intrinsic / 已
   * masked 自动跳过。注:不动 .prototype(mixin getter 残留属另一类泄漏,单独清理)。
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
   * 消除"对象上具名普通函数"残留的 .prototype own 属性(见头注:wrap 只改外观,deproto 还换函数对象)。
   * 根因:jsdom 把 atob/setTimeout/XPath 等实现为普通 function declaration,其 .prototype 描述符
   * non-configurable —— delete/赋值删不掉,Proxy 受不变式约束亦藏不住。真机 native 方法无 own .prototype,
   * 残留即 tell。唯一出路:用本就无 .prototype 的 callable 整体替换函数对象。据 receiver 形态择制造法:
   *   bindTo 给定(singleton receiver,如 window 自有 helper)→ orig.bind(bindTo):无 .prototype、继承 length、
   *     不注入栈帧;jsdom this-宽容(实测错 this 不抛),绑定固定 receiver 不破坏正常调用。
   *   bindTo 省略(per-instance receiver,如 Document.prototype 方法,this 随实例变)→ concise-method
   *     forwarder:转发 this 故能跨实例,其 length 砸为 0、由 fn() 显式校正。
   * 名集见调用方(patch/window 的 NO_PROTOTYPE,据 L2 基线 hasPrototype)。
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
   * 根因:own 字符串键枚举序 = 插入序;jsdom 建原型的插入序 ≠ Blink IDL 序,且后续 patch 注入的键只能
   * append、插不进原生键中间 → 整体序错(可逐项对比,强 tell)。redefine 不改位置,故唯一修法:抓全部
   * 描述符 → 删全部 configurable 字符串键 → 按 order 逐个原样重建(getter 身份/value/flags 不变 → 行为不变)。
   * 只动字符串键(整数索引键恒在其前、Symbol 键恒在其后,均不参与 getOwnPropertyNames 比较)。
   * 漂移防护:实际键集 ≠ order 集时经宿主 console 告警(order 缺的键按原序 append、多的跳过),把"注入键集
   * 变动 / 真机版本漂移致 order 过期"暴露而非静默错位。non-configurable 键留原位;全 configurable 方达精确真机序。
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
  // 接口原型登记表:finalizeIfaces() 把 constructor own 键挪到**末位**。根因:own 字符串键枚举=插入序,建原型时
  // 先 defineProperty('constructor') 再装方法 → constructor 恒为首键,而真机 WebIDL 接口原型它恒在末位
  // (getOwnPropertyNames(proto)[0]==='constructor' 即穿)。只纠 constructor 位置(最廉价 tell);非 constructor 键
  // 仍为插入序(真机为 Blink IDL 序)、缺成员未补 —— 完整键序保真留长期。可构造壳(audio/canvas)经 markCtorProto 登记。
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

  // 伪 EventTarget 原型登记表:parent 接到 window.EventTarget.prototype 的 mask 造接口,其实例无 jsdom EventTarget
  // slot(brandless)→ 经原型链继承到的 add/removeEventListener/dispatchEvent 一调即抛 jsdom brand-check。
  // patch/eventtarget 据本表对这些实例 short-circuit。**按 proto 登记**(非预枚举实例)→ 自动覆盖页面运行期才 new
  // 的壳(Worker/RTCPeerConnection/Notification/MediaQueryList…),实例集做不到。
  const brandlessProtos = new Set();
  function markBrandless(proto) { if (proto && typeof proto === 'object') brandlessProtos.add(proto); return proto; }
  // 设原型父链;父为 EventTarget.prototype 时顺带登记 brandless(mask 造接口实例必无 jsdom slot,无误判)。
  function setParent(proto, parent) {
    Object.setPrototypeOf(proto, parent);
    if (parent === window.EventTarget.prototype) markBrandless(proto);
  }
  /** 把 proto 接到 EventTarget.prototype 并登记 brandless —— 供 protochain/screen/matchMedia 等直接 reparent 处用。 */
  function eventTargetProto(proto) { setParent(proto, window.EventTarget.prototype); return proto; }
  /** obj 是否伪 EventTarget(原型链至 ETP 之前命中某 brandless proto)。供 patch/eventtarget 的 brand-check short-circuit。 */
  function isBrandlessEventTarget(obj) {
    const ETP = window.EventTarget.prototype;
    for (let p = obj == null ? null : Object.getPrototypeOf(obj); p && p !== ETP; p = Object.getPrototypeOf(p)) {
      if (brandlessProtos.has(p)) return true;
    }
    return false;
  }

  const ifaceRegistry = new Map();
  function iface(name, props = {}) {
    // 重名守卫:两个 patch 抢注同名 window 接口类会令后者静默覆盖前者(且先注册的实例 proto 身份分裂)。
    // 命中即复用首注册(幂等)并经宿主 console 告警(Node realm,非页面可见)—— 把设计冲突暴露而不崩 realm。
    if (ifaceRegistry.has(name)) {
      try { console.warn(`[mask.iface] 重复注册 window.${name},复用首注册(检查是否两 patch 抢注)`); } catch { /* noop */ }
      return ifaceRegistry.get(name);
    }
    // 抛 window-realm TypeError(非 Node realm,否则页面 `catch(e){e instanceof TypeError}` 为 false → tell,
    // 同 adopt 跨 realm 契约)。message 须带 `Failed to construct '<Name>': ` 前缀(真机[实测]Blink 形态;裸
    // 'Illegal constructor' 逐字比对即穿)。真机 .stack 首行**剥**该前缀 —— 由 patch/stack 复刻该分叉。
    const ctor = fn(function () { throw new window.TypeError(`Failed to construct '${name}': Illegal constructor`); }, name);
    const proto = adopt(tag({ ...props }, name)); // proto 链落在 window.Object.prototype
    ctor.prototype = proto;
    Object.defineProperty(proto, 'constructor', { value: ctor, configurable: true, enumerable: false });
    Object.defineProperty(window, name, { value: ctor, writable: true, configurable: true, enumerable: false });
    markCtorProto(proto); // 登记 → finalizeIfaces() 把 constructor 挪到 own 键末位(对齐真机 WebIDL)
    /** 基于该接口原型创建一个 window 身份的实例。 */
    const create = (extra = {}) => Object.assign(Object.create(proto), extra);
    const reg = { ctor, proto, create };
    ifaceRegistry.set(name, reg);
    return reg;
  }

  /**
   * iface 的**可构造**对偶:真机可 new 的接口(OfflineAudioContext/AudioContext/AudioBuffer/Path2D/
   * Worker/RTCPeerConnection/Notification/PerformanceObserver…)。区别 iface 的"new 即抛 Illegal":
   * 无 new 调用才抛,带 new 则 init(self, args) 初始化实例(args 可用于参数校验并抛错)。无-new 文案
   * 统一为真机[实测]完整句(短句逐字比对即偏离);经 markCtorProto 保证 constructor 落 own 键末位
   * (不依赖"装方法/装 constructor 的书写顺序",见 iface 头注)。
   * opts = { parent?, methods?, accessors?, statics?, props? }:parent=插入父原型(如 EventTarget.prototype);
   * statics=装在 ctor 自身的 data 方法。返回同 iface 的 { ctor, proto, create }。
   */
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
    if (opts.statics) methods(ctor, opts.statics);
    Object.defineProperty(window, name, { value: ctor, writable: true, configurable: true, enumerable: false });
    markCtorProto(proto);
    const create = (extra = {}) => Object.assign(Object.create(proto), extra);
    return { ctor, proto, create };
  }

  /**
   * iface 的常见用法糖:建接口类 + 装 native 方法/getter(可选插父原型)+ 创建单例实例并返回。
   * opts = { methods?, accessors?, props?, parent? }(methods/accessors 见下;props=实例自有数据;parent=
   * 插入的父原型如 EventTarget.prototype)。需"一类多实例"或要分别操作 proto/create 的,直接用底层 iface。
   */
  function singleton(name, opts = {}) {
    const { proto, create } = iface(name);
    if (opts.parent) setParent(proto, opts.parent); // parent=ETP 时自动登记 brandless
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

  /**
   * accessor 的**实例态**变体:getter 以 `this`=实例 调用(读每实例状态,如关联 <canvas>),装在共享 prototype 上。
   * 区别 accessor 的两点:① getter 读 `this`,② **不自动 adopt**(返回值多为 primitive 或已是 window 身份的对象;
   * 需要时由 getter 自行 adopt)。装法经 get-syntax forwarder(`{ get [name]() { return getter.call(this); } }`)
   * 而非把调用方传入的裸普通函数直接 native —— 后者残留 non-configurable 的 own .prototype(接口原型被 L1 probe
   * 扫即结构 tell;真机 native 访问器无),get-syntax getter 无 own .prototype 且能转发 this(根因详见 reflectAccessor)。
   * inst=单个;instAccessors=批量。
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

  /**
   * 装可写 on* 事件处理器访问器(get+set,默认 null)。真机 onX 是原型上的**可写** accessor:get-only 会令
   * strict 模式 `obj.onX = fn` 抛 TypeError(被 jsdom 异步路径静默吞,正是可观测性盲态);改用 data 属性又会在
   * 实例上造 own 键、破坏"空实例"不变量。委托给 reflectAccessor(默认 null + per-instance WeakMap 回写):on* 名单
   * 多装在 Element/HTMLElement.prototype 这类**共享非单例**原型上,单 closure 存储会跨实例污染(设过任一元素的 onX
   * 后,未赋值的别的元素读回同值、且互相覆盖)—— per-instance 存才守住"未赋值实例读回 null"。形态逐字段同其余反射
   * 访问器(get 'get X'/0、set 'set X'/1、native、enumerable+configurable),L1 形态零变化。
   */
  function eventHandler(target, name) {
    return reflectAccessor(target, name, () => null, true, null);
  }

  /**
   * 可写反射 IDL 属性访问器(get+set,带**非 null** 默认 + per-instance 回写)。区别 eventHandler(默认恒 null,
   * 对 on* 正确):少数可写反射属性真机默认是具体类型值(adoptedStyleSheets→数组 / innerText→string /
   * designMode→'off'),null 默认会在页面 init 正常 for...of / .trim() / 读时抛或成值 tell —— 在 sensor 运行前
   * 中断执行(正是 base/jsdom 裸 VirtualConsole 静默吞异步错误所放大的盲态)。形态逐字段同 eventHandler(get
   * 'get X'/0、set 'set X'/1、native、enumerable+configurable),故 L1 形态零变化。
   * get/set 均经 **get-/set-syntax**(`{ get/set [name](){} }`):无 own .prototype(普通 function expr 有,且
   * non-configurable 删不掉 → DOM 原型被 L1 probe 扫即结构 tell;真机 native 访问器亦无),且能绑 this(箭头不能)。
   * 回写:per-property WeakMap 存每实例写值(选 WeakMap 而非实例 own 槽 —— 后者造 own 键、破坏"空实例"不变量;
   * 顺带消 eventHandler 单 closure 的跨实例污染)。get 优先返存值、否则 getDefault.call(this)(读实例态,如
   * innerText 取 this.textContent)。存**逐字**值:正常类型赋值即 round-trip。
   * coerce(可选):存前保型。有类型契约的 crasher 子集(innerText/outerText→string、adoptedStyleSheets→array)
   * **必须**给 —— 否则 `el.innerText=null` / `=[]` 外的不兼容值入存,用时 .trim()/for...of 即崩,复活防抖目标
   * (且被 base/jsdom 裸 VirtualConsole 静默吞成不可见 sensor 中断)。cosmetic 标量无 coerce、逐字存(值 tell 无碍)。
   * 真机 enumerated 规范化(spellcheck 'yes'→true / contentEditable 非法值→抛 / designMode 大小写归一)无基线不臆造,留细化。
   * writable 三态:
   *   true   —— per-instance WeakMap 存(默认,见上)。
   *   false  —— no-op set:真机 readonly(fullscreenEnabled,赋值静默忽略、读回不变),保 no-op 才 match。
   *   函数   —— 自定义 set 体(以 this=实例 调用),用于赋值前向到子对象的 [PutForwards](part = v 实为
   *             part.value = v;前向给 jsdom 真实 value setter,DOMString 转换/抛由其负责,勿手 coerce)。
   * 自定义 setter 仍经 set-syntax+native(无 own .prototype、'set X'/1)→ 形态零变化。
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
    iface, ctorIface, singleton, method, methods, accessor, accessors, instAccessor, instAccessors, eventHandler, reflectAccessor, mixin, adopt, boot,
    promise, pending, reorderOwnKeys, markCtorProto, finalizeIfaces, eventTargetProto, isBrandlessEventTarget,
  };
}
