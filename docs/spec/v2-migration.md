# mimic v2 迁移与验收

状态:已完成。v2 在 0.2.0 通过全部切换门并成为默认运行时;0.3.0 删除兼容入口和旧运行实现。
本文件保留阶段验收记录,冻结行为 Oracle 继续作为回归基线。

## P0 Oracle

交付物:

- 固定 v1 commit、Node/jsdom 版本和测试清单。
- 固定 Profile/基线清单、显式配对和 TELL/EXTRA 预算。
- 可重复的 Realm 创建、串行吞吐、worker 吞吐与内存 benchmark。
- 为 run、capture、trace、timeout、序列化建立代表输入和预期结果。

退出门:v1 全套测试通过;Oracle 命令输出机器可读 JSON;benchmark 可在同机重复执行。

## P1 Contract

交付物:TypeScript strict、JSON Schema、Profile/Shape/Page/Job/Plan/Result/Support 类型和稳定错误码。

退出门:合法 fixture 全过;每类非法边界至少一个从公共解析 API 观察的失败用例。

## P2 Import

交付物:Legacy Profile Importer、继承展开、数据拆分、provenance 和 migration report。

退出门:当前 1012 个可用 Profile 均可迁移或进入显式拒绝清单;无静默字段丢失;身份段不跨 capture 混合。

## P3 Plan

交付物:Catalog resolver、Feature graph、Shape IR、冲突/Support/Engine 检查、canonical JSON 和 Plan ID、
`plan --explain`。

退出门:代表桌面 Chrome、Android Chrome、Android WebView 计划稳定;故意构造的循环、冲突、缺 Driver、
Support 不足和不可执行操作全部 fail-fast。

## P4 Engine

交付物:jsdom Engine Port、source Shape manifest、原子 Installer 和结构原语内部实现。

退出门:Window/Navigator/Screen 基础集的 v2 Probe 对 v1/真机预算不回退;失败安装不泄漏 Runtime。

## P5 Feature

按纵向批次迁移:

1. navigator/uadata/plugins/screen/viewport/chrome/touch
2. globals/dom/event/prototype/stack/symbol
3. timezone/clock/performance
4. canvas/webgl/audio
5. trace 与请求捕获 Driver

退出门:每批只从公共 Runtime/SDK 接缝测试;旧专项测试有等价 v2 conformance;无 Feature import jsdom。

## P6 Run

交付物:统一 Job/Result codec、run/capture/probe/diagnose task、worker executor、SDK、CLI 和 HTTP adapter。

退出门:相同 Job 的 SDK/worker/HTTP 语义一致;同步死循环、死 microtask、序列化 trap、close 污染和队列
背压测试通过。

## P7 Collect

交付物:`collect` 真机采集、`probe` Shape 采集、Catalog importer 和 schema migration。

退出门:一次真机访问分别生成 Capture/Profile 与 Shape;原始证据不可被 normalize 覆写;Schema 版本可迁移。

## P8 Cutover

切换门:

- 当前全部 Profile 编译成功。
- 五组显式 Profile/Baseline 的 EXTRA 和 TELL 不高于 P0 预算。
- run/capture 的 golden corpus 与 v1 等价。
- 安全回归全部通过。
- 同机创建延迟、吞吐和峰值内存默认不回退超过 20%。
- 两轮持续运行无 Runtime/worker 泄漏。
- SDK、CLI、HTTP 文档覆盖每个用户任务。

全部门通过后先完成默认入口切换;0.3.0 已删除短期兼容层及旧 `entry/core/base/capture/mask/patch/trace`
运行实现。旧格式 Profile 数据导入器仍作为 P2 数据边界保留,不属于已删除的运行时。

## 固定 Oracle

起始 commit:`83624a22425c9178ff714d5ca90b332edc70dcf6`

结构配对预算:

| Profile | Baseline | EXTRA max | TELL max | MISSING max |
|---|---|---:|---:|---:|
| chrome-mac | macos-chrome-v148 | 0 | 1 | 7 |
| macos-chrome-v148 | macos-chrome-v148 | 0 | 0 | 7 |
| macos-chrome-v149 | macos-chrome-v149 | 0 | 0 | 8 |
| android-webview-v138 | android-webview-v138 | 0 | 0 | 0 |
| linux-chrome | linux-chrome-v143 | 0 | 0 | 0 |

这些预算只覆盖当前 Probe target,不能推断整个 window surface 已被守护。1012 个 Profile 主要是身份数据,
不是 1012 份独立 Shape 真值;无真机 Shape 的版本必须标记为 `derived`。
