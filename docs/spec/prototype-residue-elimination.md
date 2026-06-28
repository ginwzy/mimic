# .prototype 残留清除:经验验证与实现方案

## 背景

jsdom 把若干 window helper(atob/btoa/setTimeout 等)和 DOM XPath 方法实现为普通 function
declaration,导致这些函数在 native 化(mask.wrap)后仍残留 `.prototype` own property。
真实 Chrome 的 native 方法无 own `.prototype`。另一类残留来自 mask.mixin 用 `fn(function
() {...})` 造的 getter —— 普通函数有 `.prototype`,箭头函数没有。

## 现状[实测] — 基于 android-webview-v138 基线

```
GATE: FAIL — 48 个阻断项
  mixin getter 侧   32 条 (accessor.get.hasPrototype + accessor.get.ownNames) — 未白名单
  方法侧(jsdom fn) ~50 条 (fn.hasPrototype + fn.ownNames)                  — 已白名单
  XPath 方法        6 条  (fn.ownNames 含 arguments,caller,prototype)        — 已白名单
  其他阻断          ~10条  (ownKeys.order / window.print / Document.constructor 等)
```

## 两类残留的根因与可修性

### 类型 A:mixin getter 侧(可真修)

`mask.mixin` 内部用 `fn(function () { return adopt(getValue()); }, ...)` 造 getter。
普通函数有 `.prototype` own 属性;箭头函数没有。

**关键约束[实测]**:所有 mixin getValue 闭包均不使用 `this`(仅读闭包变量 p/nav/conn),
替换为箭头函数不破坏任何调用语义。

修法:`mask.mixin` 中把 getter 造法改为箭头函数:
```js
const get = dropOwnToString(fn(() => adopt(getValue()), `get ${key}`));
```
`fn()` 对箭头函数调用 `Object.setPrototypeOf(func, WFunctionProto)` 无副作用;
`dropOwnToString` 保持不变。修后:
- `'prototype' in getter` → false ✓
- `Object.getOwnPropertyNames(getter)` → `["length","name"]` ✓
- 预期消除:16 × `accessor.get.hasPrototype` + 16 × `accessor.get.ownNames` = 32 条阻断

**同一不变量的其余持有者**:`mask.mixin` 的 getValue 不读 `this`,箭头函数即可(上)。读 `this` 的实例态
访问器——`instAccessor`(读关联 `<canvas>`/节点状态)与 `reflectAccessor`(读 per-instance 回写)——箭头不能绑
`this`,改用 **get-syntax forwarder**(`{ get [name]() { return getter.call(this); } }`):同样无 own `.prototype`
且能转发 `this`。三者共同守住"native getter 无 own `.prototype`"这一结构不变量,覆盖 plugins/audio/canvas/webgl
等接口原型上的实例态 getter。

### 类型 B:方法侧 jsdom function declaration(当前无法静默删除)

`atob`/`setTimeout` 等在 window 上的描述符 configurable:true —— 可以**替换**整个函数对象。
替换方案:concise-method forwarder(无 `.prototype`、无 `arguments`/`caller`):

```js
function makeFwd(orig, name, len) {
  const m = { [name](...args) { return orig.apply(this, args); } }[name];
  if (typeof len === 'number')
    Object.defineProperty(m, 'length', { value: len, configurable: true });
  return m;
}
```

**经验验证[实测]**:
- `'prototype' in fwd` → false ✓
- `Object.getOwnPropertyNames(fwd)` → `["length","name"]` ✓
- `fwd('aGVsbG8=')` → `"hello"` (this=undefined 亦正常) ✓
- `setTimeout(() => {}, 0)` via forwarder → 返回 timer id ✓
- `getComputedStyle(body)` via forwarder (this=undefined) → object ✓
- 替换 window.atob 后 `'prototype' in window.atob` → false ✓
- 顺带消除 `arguments,caller` 残留(concise method 是严格模式)

**安全边界 — VESTIGIAL prototype 不能作通用识别启发式**:
sweep 扫到的 65 个 VESTIGIAL 函数(prototype 只有 constructor)中,既有 `atob`/`setTimeout`
这类 helper,也有 `HTMLSpanElement`/`Location`/`Window`/`Audio`/`XMLDocument` 等真构造器。
真构造器在真机本就有 `.prototype`(非 tell),且 forwarder 会破坏 `new`。
因此方法侧替换必须用**有界已知集**,不能在 sweepOwn 里做通用判定。

当前 probe 目标集里的方法侧候选(需确认哪些在白名单内):
- window 上的 helper 函数(atob/btoa/setTimeout/setInterval/clearTimeout/clearInterval/
  alert/blur/close/confirm/focus/open/postMessage/print/prompt/queueMicrotask/
  getComputedStyle/getSelection/moveBy/moveTo/resizeBy/resizeTo/scroll/scrollBy/scrollTo/
  captureEvents/stop/requestAnimationFrame/cancelAnimationFrame 等)
- Document.prototype 的 evaluate/createExpression/createNSResolver

这些目前已被白名单覆盖。真修它们收益(减少白名单条目,让 gate 在不依赖白名单前提下通过)与
成本(在 sweepOwn 外维护一份有界集)需评估后决定是否推进。

## 实现顺序建议

1. **优先**:`mask.mixin` 一行改箭头,消除 32 条未白名单阻断 —— 改动极小、零风险。
2. **可选**:方法侧有界集替换 —— 效果是把白名单条目变为 gate 真通过,提高防伪装质量;
   代价是维护一份 helper 函数名单(或扩展 sweepOwn 识别逻辑)。
3. 若做方法侧,白名单对应条目同步删除(yvq.11 的两条 fn.hasPrototype / fn.ownNames 规则)。

## 类型 B —— 制造技术再探(实测结论)

`.prototype` 在普通函数上 non-configurable,无法就地去除;任何方案本质都是**用一个本就无 `.prototype`
的 callable 整体替换函数对象**,再过 `fn()` 掩码。三种 callable 制造法实测对比:

| | concise forwarder | **bound fn** `orig.bind(recv)` | arrow |
|---|---|---|---|
| `prototype` 消除 | ✓ | ✓ | ✓ |
| ownNames | `[length,name]` | `[length,name]` | `[length,name]` |
| **length** | 0,须显式校正 | **自动继承 `orig.length`** | 0,须校正 |
| name | 自动 | `"bound X"`,须 1 行校正(configurable) | 错,须校正 |
| `this` | **转发**(`apply(this)`) | 固定到 recv(抹除) | 词法(抹除) |
| 错误栈包装帧 | 有(1 帧) | **无(引擎内 trampoline)** | 有 |

**择技按 receiver 形态分裂**(关键):
- **singleton receiver**(window 自有 helper:atob/setTimeout/...)→ **bound fn**,绑 `window`。
  优:自动 length(免 arity 表)、不注栈帧。`this` 抹除无损 —— 实测 jsdom 实现 **this-宽容**
  (`setTimeout.call({})` 等不抛 Illegal invocation),concise forwarder 转发 `this` 也复刻不出
  真机的抛错,故两者在此轴同样偏离;bound 不更差。
- **per-instance receiver**(`Document.prototype` 的 evaluate/createExpression/createNSResolver,
  `this` 随调用实例变)→ **必须 concise forwarder**;bound 固定 receiver 会破坏跨实例 `this`。
  实测:jsdom 这三个方法 ownNames = `[length,name,arguments,caller,prototype]`(非严格 function
  declaration),forwarder 一并清掉 arguments/caller/prototype 三者,`doc.evaluate(...)` 正常。

## 类型 B —— 圈定集合:基线驱动是**必需**而非"更优"(实测)

spec 初版担心"手维护 helper 名单易错、VESTIGIAL 启发式误伤真构造器"。实测把这点坐实并加强:
纯运行时结构启发式 `protoDesc.writable===true && prototype 仅含 constructor(vestigial)` 扫出 40 个
候选,但其中 **`Window` / `StyleSheet` / `CSSRule`(及 legacy `XPathException`)是真接口构造器**——
真机有 `.prototype`,只是 jsdom 把其 prototype 留空,看起来与 helper 无异。任何运行时信号都分不清
"vestigial 因为 jsdom 没填" 与 "vestigial 因为它本就是普通 helper"。

**唯一可靠 oracle = L2 真机基线的 `hasPrototype===false`**:真机 `Window`/`StyleSheet`/`CSSRule`
的 `hasPrototype===true` → 天然排除;`atob`/`setTimeout` 的 `hasPrototype===false` → 命中。落地形态
沿用本文件既有 `ARITY` 表先例(同样"baseline-derived 常量"):patch/window 内置一张 `NO_PROTOTYPE`
名单(键按 owner label,值取基线 `hasPrototype===false` 名集),sweep 时仅当"名在表中 **且** jsdom
确有残留 `.prototype`"才替换。失败模式安全:漏列 → 残留 tell(被 gate/diff 抓),不会误伤构造器
(对比"排除名单"漏列 → 破坏 `new`)。后续可由基线 codegen 此表,免手维护。

## 已排除方案

- **`delete func.prototype`**:`delete` 对 non-configurable descriptor 无效,静默失败。
- **赋值 `func.prototype = undefined`**:只改值,`'prototype' in func` / getOwnPropertyNames 仍暴露 key。
- **Proxy 拦截 `ownKeys`/`getOwnPropertyDescriptor`/`has` 隐藏 prototype**:实测**全部抛 TypeError**
  —— non-configurable own 属性受 Proxy 不变式硬约束,连 `has` trap 都不能对其返回 false。彻底出局。
- **VESTIGIAL / writable 启发式通用替换**:误伤真构造器(Window/StyleSheet/CSSRule,见上)。
