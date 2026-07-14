# mimic 架构契约

状态:Stable
范围:Chromium 环境回放、脚本执行、请求捕获与真机结构验证

## 1. 目标

mimic 的目标不是实现浏览器,而是对给定脚本复现目标浏览器的**可观察契约**。可观察面包括值、属性
归属、描述符、函数形态、原型链、键序、跨 Realm 身份、调用行为和时序。

当前实现把这些事实先编译成不可变 `Plan`,再由 `Engine` 安装成 `Runtime`;不再把架构建立在一组可任意
修改 `window` 的 patch 上。

```text
Capture -> Profile
Probe   -> Shape

Profile + Shape + Page + Job
              |
              v
            Plan
              |
        Engine -> Runtime
              |
            Result
```

## 2. 术语

| 名称 | 含义 |
|---|---|
| `Capture` | 真机原始采集结果,只追加、不推导 |
| `Profile` | 规范化且保持单次采集相关性的设备身份 |
| `Shape` | 浏览器版本/平台的可观察结构清单 |
| `Page` | URL、HTML、cookie、时间与随机序列等页面上下文 |
| `Job` | `run`、`capture`、`probe` 或 `diagnose` 任务 |
| `Plan` | 完整校验后生成的纯数据安装计划 |
| `Feature` | 一项浏览器能力及其依赖声明 |
| `Driver` | Feature 的有状态行为实现 |
| `Engine` | jsdom 等底层运行时适配器 |
| `Runtime` | 已原子安装完成、可执行一个 Job 的环境 |
| `Support` | captured/derived/emulated/shape-only/unsupported 支持报告 |

同一个词只表达一个概念。CLI 中 `collect` 专指真机采集,`capture` 专指运行时请求体捕获。

## 3. 领域分层

依赖只允许向下:

```text
SDK / CLI / HTTP
       |
Application (run/capture/probe/diagnose)
       |
Domain + Compiler + Shape IR
       |
Ports
       ^
Engine / Executor / Catalog / Collector adapters
```

约束:

1. `domain`, `compiler`, `shape` 不得 import jsdom、worker、HTTP 或文件系统。
2. Feature 不得接收完整 Runtime;它只声明 Shape 贡献和所需 Driver ID。
3. Driver 只能通过窄 Engine Port 访问运行时。
4. Profile 默认值只在 normalize 阶段产生;叶子 Feature 不得猜设备值。
5. Plan 只含 JSON 安全数据;行为实现以稳定 Driver ID 引用,不得携带闭包。
6. Runtime 安装默认 fail-fast。失败时丢弃整个新 Realm,不返回半安装环境。

## 4. 数据边界

旧 Profile 在导入时完全展开 `extends`,随后拆分:

- `navigator/screen/window/timezone/webgl/canvas/audio/fonts` -> `Profile`
- `location` -> `Page.url`
- `timing` -> `Page.clock`
- `meta.traits` -> Capture 证据;Profile 的平台事实与 Shape 引用重新推导
- `meta.source/fidelity/hygiene` -> 字段来源和 Support

Profile 的指纹段绑定同一个 capture ID。默认由 Profile 选择 Shape;手工组合不一致 Shape 必须显式启用
`synthetic`,并在 Result 中永久标记。

## 5. Compiler

固定阶段:

```text
parse -> normalize -> validate -> resolve -> check -> lower -> hash
```

- `resolve`:选择 Shape、Feature 和 Driver。
- `check`:检查 Feature 依赖、重复写入、最低 Support 和 Engine 可行性。
- `lower`:生成有序 Shape 操作。
- `hash`:对 canonical JSON 计算稳定 Plan ID。

Compiler 是纯函数。同一输入、Catalog 版本和 Engine manifest 必须生成相同 Plan ID。

## 6. Shape IR

Shape IR 只表达结构操作,不尝试成为浏览器行为语言。首版允许:

- 定义/删除属性
- 定义接口、构造器、方法和访问器
- 设置原型与对象标签
- 创建 singleton
- 调整 own-key 顺序
- 包装已有函数形态
- 将方法或接口绑定到 Driver ID

复杂状态机、网络、Canvas、WebGL、Audio、时钟和事件循环留在 Driver。Engine 必须在安装前检查
non-configurable/unforgeable 属性;不可执行的操作是 compile/install 错误,不能静默忽略。

## 7. 公共接口与测试接缝

稳定 SDK 仅暴露:

```js
await mimic.run(job)
await mimic.capture(job)
await mimic.plan(input)
await mimic.list(kind)
```

高级入口放在 `mimic/advanced`,包括自定义 Engine、Driver 和交互式 Runtime。内部 Shape 原语不从默认入口
导出。

TDD 只从以下已确认接缝观察行为:

1. SDK `run/capture/plan/list`。
2. CLI `run/capture/collect/probe/diff/plan/list/serve`。
3. Legacy Profile 导入器。
4. 冻结行为 Oracle、真机基线与当前 Runtime 对同一 Probe 和代表脚本的差分结果。
5. HTTP/worker 的统一 Job/Result 协议。

测试不得 mock Compiler 内部阶段或断言私有调用顺序。

## 8. 错误与支持等级

Result 的失败阶段固定为 `parse|compile|install|run|encode`;每个错误含稳定 code、message、可选 details
和 Plan ID。安装告警不能只写 console。

Support 等级从强到弱为:

```text
captured > derived > emulated > shape-only > unsupported
```

Job 可声明最低等级。不能满足时 compile 失败;未声明最低等级时仍须在 Result 报告实际等级。

## 9. 非目标

- 不实现完整浏览器或真实布局/渲染。
- 不在 Runtime 架构层提高未经采集证实的指纹保真度。
- worker 不是多租户安全沙箱;对外服务仍需进程/容器隔离。
- 首版不支持非 Chromium 引擎。
- 不为追求抽象而把任意 JavaScript 行为塞进 Shape IR。
