# sdenv-jsdom 2.1.0 vs jsdom 27.0.1 对等性评估

调研日期:2026-06-30 | 关联 issue:yvq.10

## 概要

sdenv-jsdom 是 sdenv 补环境框架对 jsdom 27.0.1 的 fork。31 个文件有代码差异,
4231 行 patch。改动可分为以下类别。

## 改动分类

### 1. `_globalObject` → `_sdGlobalObject` 批量重命名(~710 行)

占全部改动的 50%。把 jsdom 内部属性名 `_globalObject` 改为 `_sdGlobalObject`,
防止检测脚本通过 `'_globalObject' in window` 判定 jsdom 环境。

mimic 现状:patch/symbol.js 已过滤 jsdom 内部 Symbol,但 `_globalObject` 是
字符串属性名,需确认 harness diff 是否已捕获为 EXTRA 键。可在 patch 层 delete。

### 2. Location.js 重写(~650 行)

删除官方 jsdom 的 unforgeable 机制(getUnforgeables + configurable:false),
方法直接定义在 class 上。unforgeable 实现导致属性描述符与真机不同。

mimic 现状:未处理。是唯一可能需要 fork 才能解决的点(描述符在 jsdom 内部设置,
外部 patch 难以在正确时机拦截)。需实测目标站点是否检测此差异。

### 3. document.body renderBodyFlag(api.js + Document.js)

在 `<body>` 标签后注入脚本,setTimeout(0) 设 renderBodyFlag;Document.body
getter 在 flag 为 false 时返回 null。模拟 DOM 解析完成前 document.body 为 null
的真实浏览器行为。瑞数 VMP 依赖此时序。

mimic 现状:未实现,但可在 patch 层用 Object.defineProperty 拦截 body getter。

### 4. HTMLFormElement Proxy

给 form 元素包 Proxy,支持通过名字索引子元素(如 `form.username`)。
功能补全,非反检测核心。mimic 未处理,patch 层可做。

### 5. Navigator 属性补齐

新增 webdriver/maxTouchPoints getter,修改 appVersion/platform/vendor 默认值。
**mimic 已通过 patch/navigator.js 完整覆盖**(profile 驱动)。

### 6. NavigatorLanguage 硬编码

language 从 "en-US" 改为 "zh-CN"。**mimic 已通过 profile 覆盖**。

### 7. 内部属性重命名(xpath.js)

`_ast` → `_sdAst_210`, `_doc` → `_sdDoc_210`。xpath 属性通常不在检测面。

### 8. resource-loader HTTP 状态码

注释掉非 2xx 响应的 abort 逻辑。对外部资源加载场景相关。

### 9. js-globals.json 键顺序

Atomics/SharedArrayBuffer 顺序微调。可能影响全局对象枚举顺序。

### 10. MouseEvent 构造参数透传 / debugger 语句

功能补全/调试用途。

## 结论

**当前不需要 fork。**

| 改动 | 反检测影响 | mimic 已覆盖 | 需 fork |
|------|----------|-------------|---------|
| _globalObject 重命名 | 高 | 部分 | 否(patch 层 delete) |
| Location unforgeable | 中 | 否 | 待实测 |
| renderBodyFlag | 高(瑞数) | 否 | 否(patch 层可做) |
| Navigator 补齐 | 高 | 是 | — |
| 语言硬编码 | 低 | 是 | — |

Location unforgeable 描述符差异是唯一可能需要 fork 的技术点,但需先实测目标站点
是否真的检测。建议:先补 patch 层方案,实测目标站点,仅在 patch 层无法解决时 fork。

mimic 的 base/jsdom.js 已隔离 jsdom 依赖,切换到 sdenv-jsdom 只需改一处 import。
