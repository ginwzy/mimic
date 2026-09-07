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
| `Page` | URL、HTML、cookie、时间与随机序列,以及可选的有限布局快照 |
| `Job` | `run`、`capture`、`probe` 或 `diagnose` 任务 |
| `Plan` | 完整校验后生成的纯数据安装计划 |
| `Feature` | 一项浏览器能力及其依赖声明 |
| `Driver` | Feature 的有状态行为实现 |
| `Engine` | jsdom 等底层运行时适配器 |
| `Runtime` | 已原子安装完成、可执行一个 Job 的环境 |
| `Support` | captured/derived/emulated/shape-only/unsupported 的 v2 兼容标签 |
| `CapabilityReport` | 独立记录证据来源、行为覆盖及兼容标签的编译报告 |

同一个词只表达一个概念。CLI 中 `collect` 专指真机采集,`capture` 专指运行时请求体捕获。

## 3. 领域分层

依赖只允许向下:

```text
SDK / CLI / HTTP -> Planner -> Compiler + Shape IR -> Plan
       |                                               |
WorkerExecutor -> WorkerPool -> worker -> TaskRunner <--+
                                             |
                                   Engine -> Runtime
                                             |
                           ExecutionSession + Driver sessions
```

`app/planner.ts` 只接收 Profiles、Features、Driver ID 和 Engine manifest,不创建 Runtime。
`runtime/runner.ts` 只执行已编译任务。高级入口 `Application` 通过组合连接两者,不再继承执行层。
`node/` 负责选择具体实现;`engine/manifest.ts` 可独立计算 Engine 身份,不加载 jsdom 安装逻辑。

`WorkerPool` 接收规划依赖,不创建 Application。`WorkerExecutor` 保留为 Node 便利入口。
worker 只接收 Job 与 Plan 引用/数据,不接收完整 Profile 请求。客户端构造、`list` 和 `plan` 不启动
worker;首次执行按并发需要创建 worker。

`runtime/task.ts` 将已编译 Plan、规范化 Job 和有效 Realm 执行策略组合为 `PreparedExecution`。
父线程准备 Job/策略并随每次 worker 消息发送,Plan 仍按 ID 缓存;进程内执行走同一准备函数。
`core/job.ts` 单独校验与规范化 Job,执行端不加载 Profile/Shape 解析器。现有 `parseJob` 公开导出不变。
任务不以 Plan ID 作为完整运行指纹:代码、交互 seed 和捕获策略可以不同而复用同一安装 Plan;
probe 源码仍是 Runner 的宿主依赖,排队与 watchdog 仍归 Executor 所有。

`ExecutionPolicy` 当前为 `execution-v1`,明确以下语义:

- 脚本超时只限制单次 `Runtime.run`;null 表示不额外限制。URL 为 null 时不设置 currentScript,
  保留 Runtime 的默认文件名,不能用 Plan.boot.url 填充运行参数来代替这个状态。
- capture lifecycle 为 auto 时,在用户脚本之前完成文档生命周期;none 不注入该逻辑。
- 捕获 deadline 在用户脚本完成并经过一次事件循环让出后起算,按 pollMs 轮询,不是脚本总时限。
- maxPosts 统计 len > 0 的记录,包括没有可读取字符串 body 的二进制请求。
- 交互 seed 保持 Plan ID、adapter、Job seed 的既有组合;quiet 完成必须等待策略耗尽、最新交互结束、
  最新请求及至少 5000ms 的交互窗口,再等待 500ms。deadline/maxPosts 仍可更早终止捕获。
- worker watchdog 在收到 started 时开始,覆盖 worker 内执行/编码/清理,不覆盖父线程规划、排队或启动。

`runtime/capture.ts` 的 CaptureSession 拥有生命周期、交互进度、轮询和完成判定;TaskRunner 负责打开
Realm、执行分派、异常/结果编码与最终 dispose。交互帧使用 Realm 的定时器,随 Realm 一起回收。
内部 ExecuteMessage 增加有效 policy,公开 v2 Job/Plan/Result schema 不变。

交互策略将触发条件与合成时间分开: `next` 返回 recipe 和 `plannedAtMs`,Akamai 动作的计划时间
依次为 120、2500、2700ms。首次 POST 仍可提前触发第一笔 swipe,但不改变其合成时间基准。
姿态迁移按计划间隔采样,不读取实际轮询时间;实际派发、完成窗口、deadline 和 watchdog 仍使用
原来的运行时钟。同一有效 seed、模型和动作计划保证合成帧值及帧内相对时间一致,不保证真实事件
时间戳、跨动作实际间隔、POST 内容或数量一致。提前终止仍可截断程序。

每次 `Engine.open` 创建独立 ExecutionSession。Driver 可用 `createSession` 提供任务级共享状态,
`open(port)` 仍创建每个 Realm 的实例;先关闭所有 Realm 实例,再关闭任务级会话。
网络和 trace 的跨 Realm 报告由各自 `reduceReports` 聚合,Engine 不识别具体报告字段。
jsdom 内部生命周期钩子集中在 `engine/jsdom-compat.ts`,进程级钩子仅弱引用 Realm 所有者。

显式 `Page.layout` 经独立校验后进入 `Plan.boot.layout`。`engine/layout.ts` 在根 Realm 中建立
私有几何/滚动状态,统一矩形、命中、根/嵌套滚动和交互坐标;不修改不可变 Plan。布局失效检查
位于 Runtime 执行与报告边界,布局清理失败不能跳过 Driver 或 Realm 清理。它是固定视口的有限
矩形回放,不是通用 CSS 布局。默认未提供布局时仍走旧路径。输入、失败边界和证据见
[有限布局回放规范](layout-replay.md)。

Feature 按编译与执行分开组织:

| 入口 | 职责 |
| --- | --- |
| `features/compile.ts` | Feature 注册与 Driver ID,不加载 Driver 实现 |
| `features/drivers.ts` | 仅注册运行时 Driver,不加载 Feature 编译代码 |
| `features/*.compile.ts` | 各能力的结构操作、绑定配置、支持报告 |
| `features/*.driver.ts` | 各能力的 Realm 行为与任务会话 |
| `features/*.shared.ts` | 两侧实际共用的协议常量和纯函数 |
| `features/shape.ts` | Shape 产物的显式有序组合,不由 worker 加载 |
| `features/*.shape.ts` | 单个能力的 Shape 贡献,不递归调用其他贡献 |

Shape 组合复用 `Feature.requires` 解析依赖。Chrome 的 WebView 宿主结构、Touch 后的支持项和
Document 最终键序是组合入口中的显式兼容步骤,不能依赖重复调用某个 Feature 才生效。
Navigator 和网络 Feature 通过 `reserves` 声明自己的成员,DOM 通用包装器读取这些声明,不再硬编码
其他能力的属性清单。`shape/writes.ts` 统一组合、DOM 包装和 Plan 校验的写入标识及属性别名规则。

R3 只改变代码组织;当时 Feature revision、Engine ABI 和数据 schema 保持 R2 的版本。

后续职责拆分和契约演进见 [重构规划](architecture-refactor.md),实际状态见
[进度文件](../notes/architecture-refactor-progress.md)。

约束:

1. `domain`, `compiler`, `shape` 不得 import jsdom、worker、HTTP 或文件系统。
2. Feature 不得接收完整 Runtime;它只声明 Shape 贡献和所需 Driver ID。
3. Driver 只能通过窄 Engine Port 访问运行时。
4. Profile 默认值只在 normalize 阶段产生;叶子 Feature 不得猜设备值。
5. Plan 只含 JSON 安全数据;行为实现以稳定 Driver ID 引用,不得携带闭包。
6. Runtime 安装默认 fail-fast。失败时丢弃整个新 Realm,不返回半安装环境。

## 4. 数据边界

两个输入适配器分别处理格式事实,再进入同一规范化核心:

```text
profiles/fp-env.ts       HighEntropyValues、字段投影与采集缺省标记
collect/normalize.ts     identity/probe 会话关联、采集 ID 与结构证据
           |                         |
           +------ profiles/normalize.ts: normalizeIdentity ---+
                              |
                       Profile + Page + Shape
```

`normalizeIdentity` 接收显式的身份事实、页面上下文、Target、Source、Shape、采集段与派生字段。
它不读取 `meta.name`、`extends` 或迁移报告,也不做文件访问。字段补全、证据等级与最终数据校验
由这个公共路径负责。`profiles/browser.ts` 从浏览器字段中拆出 connection、页面时钟和 URL;
`profiles/target.ts` 处理身份推导与声明冲突;`profiles/shapes.ts` 负责已有 Shape 来源规则和目标校验。

`profiles/report.ts` 单独保留 v2 迁移账本、来源路径和未映射字段拒绝规则。Collect 的历史报告中仍有
合成的 `meta.name`,但它只用于保持报告字段与来源哈希兼容,不再作为规范化输入或必要条件。
公开 `MigrationReport` 类型继续可用;`FpEnvProfiles` 和 `normalizeFpEnv` 的公开导出不变。
`legacy-shape-v1` 来源标识及已有 `LEGACY_*` 错误码保留,避免结构重构引起身份或错误契约变化。

Node 默认使用 `FpEnvProfiles`,只从 `profiles/_fp-env` 原始缓存建立索引。运行与规划须显式提供
fp-env ID,不再默认选择 chrome-mac。Legacy 文件导入器、extends 展开和仓库内生成身份文件已移除;
旧采集字段的投影保留在 `collect/identity.ts`,不重新引入 Legacy 模块依赖。测试使用独立夹具,
不能把夹具验证或空生产目录的数据检查称为完整原始缓存验证。

`TaskRequest.environment` 由 Planner 在编译前解析和应用,不修改源 Profile。区域设置同时决定
Navigator 语言、Intl locale 和时区;flow 使用相同设置构造 HTTP 语言头。Time Feature revision 为 2,
旧 Time 绑定缺少 locale 时仍保留原有缺省语义。

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

SDK `capture` 返回类型化 `CaptureResult`,成功时 value 必含 syncCaptured、captured 和 posts。
`core/capture.ts` 在通用 v2 Result 校验后检查这个既有结构;高级入口提供 parseCaptureResult。
flow/capture.ts 直接消费 CapturePost,不再重复猜测或静默过滤成功结果中的字段。
NetConfig/TraceConfig 是各能力的局部联合类型,编译侧检查绑定配置,Driver 侧仍校验 JSON 输入;
通用 Engine ABI 保留 JsonValue 扩展接口,不引入包含全部 Driver 的全局联合类型。

可选闭环 capture 通过 `network` 注入宿主传输能力,每个任务使用独立 MessagePort。worker 中的
jsdom XHR/CookieJar 保持响应状态,宿主只执行明确允许 URL 的请求;Net Driver 报告在途数量,
CaptureSession 在完成判定时等待在途响应。能力不进入安装 Plan 或公开 v2 JSON,默认离线模式不变。
取消、cookie 初始化和受限 fetch 支持见 [闭环捕获规范](network-capture.md)。

TDD 只从以下已确认接缝观察行为:

1. SDK `run/capture/plan/list`。
2. CLI `run/capture/collect/probe/diff/plan/list/serve`。
3. fp-env 导入与 Collect 规范化入口。
4. 冻结行为 Oracle、真机基线与当前 Runtime 对同一 Probe 和代表脚本的差分结果。
5. HTTP/worker 的统一 Job/Result 协议。

测试不得 mock Compiler 内部阶段或断言私有调用顺序。

## 8. 错误与支持等级

Result 的失败阶段固定为 `parse|compile|install|run|encode`;每个错误含稳定 code、message、可选 details
和 Plan ID。安装告警不能只写 console。

旧 `require` 仅保留以下兼容排序,不能据此推断行为完整度:

```text
captured > derived > emulated > shape-only > unsupported
```

旧 request/compile 的 `require` 不满足时编译失败;Plan/Result 的 SupportMap 字段保持兼容。

`compileWithCapabilities` 和高级入口 `Application.inspect` 返回 Plan 及单独哈希的
`capabilities-v1` 报告。来源 `origin` 与覆盖 `coverage` 独立;例如采集得到的 Canvas
指纹仍可能只实现常量回放。新要求通过明确的允许集合匹配,不对 constant、partial 等做隐式排序。
Feature 自行声明行为,未知实现保持 unknown;当前内置能力不声明 complete。

Canvas、Audio 和系统颜色的身份合成集中在 `environment/identity.ts`,策略版本为
`legacy-identity-v1`。数值写入 Plan,Driver 不根据 Profile ID 临时合成身份。
R6 的 Canvas 绑定迁移对应 Feature rev 3 和 Engine ABI v2.11;后续有限布局安装契约将 Engine ABI
升为 v2.12,所有旧 Plan 必须重新编译。
Plan ID 的迁移也会改变依赖它的默认交互 seed,不意味着完整执行身份已由 Plan ID 表达。

能力范围、使用方式和验证命令见 [capabilities.md](capabilities.md)。资源回收、能力声明完整性
与内存预算是独立门禁;未配置内存预算只报告 observed,不宣称内存稳定。

## 9. 非目标

- 不实现完整浏览器或真实布局/渲染。
- 不在 Runtime 架构层提高未经采集证实的指纹保真度。
- worker 不是多租户安全沙箱;对外服务仍需进程/容器隔离。
- 首版不支持非 Chromium 引擎。
- 不为追求抽象而把任意 JavaScript 行为塞进 Shape IR。
