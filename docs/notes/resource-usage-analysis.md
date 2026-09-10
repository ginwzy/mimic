# 资源占用与瓶颈实测

初始采样日期：2026-09-10。基线工作树 HEAD：`675b0dddfbdec45bb8c7a98b4865b0059ef83bb9`。初次分析只新增记录；随后完成的规划缓存优化和复测见文末。下面的瓶颈数据保留为修改前基线。

结论：轻量任务主要消耗在 Realm 安装；脚本变化导致父线程重复编译并缓存同 ID 的独立 Plan；生产 worker 池的 RSS 高水位明显。回收生命周期检查通过，但不能据此认定内存预算合格或长期稳定。

## 环境与范围

- Apple M4，10 逻辑核，32 GiB，macOS arm64，Node 24.12.0，jsdom 29.1.1。
- 先执行 `npm run build`，所有性能负载串行运行，避免相互竞争。
- `profiles/_fp-env` 没有生产身份。使用唯一测试身份 `android-webview/unknown-v138-1`，根目录 `test/fixtures/fp-env`。
- 未运行线上 ANA/Cebu、真实 sensor、大规模生产身份、Android 真机或闭环网络长测。下面的每秒任务数不是线上 flow 吞吐。
- 机器不是隔离服务器；采样期间系统已有约 3.35 GiB swap 使用，`memory_pressure -Q` 的全系统 free percentage 为 51%。绝对时延和 RSS 需要在目标部署环境重测。
- 原始 JSON、CPU profile 和临时诊断脚本位于 `/tmp/mimic-resources.DCU5md/`；该目录不受 Git 管理，可能被系统清理。关键数据保存在本文。

## CPU、时延与并发

`bench` 使用 `1 + 1`，每组预热 10 次、3 轮、每轮 60 次。两种 poolSize 分别在独立子进程测量。

| 指标 | 1 worker | 4 workers |
| --- | ---: | ---: |
| 本地 plan + open 中位数 | 14.07 ms | 14.41 ms |
| 本地 plan + open P95 | 19.11 ms | 19.31 ms |
| 本地完整周期吞吐 | 63.98/s | 63.18/s |
| worker 首任务 | 314.96 ms | 325.04 ms |
| worker 热吞吐 | 58.89/s | 158.69/s |
| 混合本地/worker benchmark 的进程 RSS 峰值 | 1054 MiB | 1737 MiB |

4 workers 的热吞吐为单 worker 的 2.69 倍，扩容有收益，但并非线性。benchmark 在同一子进程中先跑本地执行，再启动 worker；其 RSS 包含两条路径的历史分配，不能当作纯 worker 常驻成本。其首任务也复用了进程内已加载的身份/Shape，不能代表全新服务启动。

另一个独立探针只通过生产 `WorkerExecutor` 执行，每次批量提交 100 个任务，共 500 个；每批后仅主线程强制 GC，生产 worker 保持默认 GC。该探针中全新进程的首任务约 584/587 ms，500 次执行含主线程采样耗时约 8.66/2.98 秒。

阶段探针预热 20 次后测量 150 个 `plan → open → run → dispose` 周期，每周期让出一次事件循环。它启用了 CPU profiler，数字只作定位：

| 阶段 | 中位数 | P95 |
| --- | ---: | ---: |
| 缓存命中的 plan | 0.116 ms | 0.184 ms |
| Engine.open | 14.121 ms | 15.764 ms |
| run(`1 + 1`) | 0.015 ms | 0.022 ms |
| dispose | 0.084 ms | 0.142 ms |

Engine.open 占上述四阶段平均耗时约 98.4%。当前测试 Plan 的 JSON 为 674,435 bytes，包含 2,602 operations、533 binds；每个新 Realm 都重新执行结构安装。

CPU profile 的自身采样占比：

| 热点 | 占比 | 实际工作 |
| --- | ---: | --- |
| Installer.applyOrder | 33.76% | 枚举属性、比较顺序、删除后重新定义或重建原型 |
| Installer.constructable | 14.18% | 通过 Reflect.construct / 异常判断可构造性 |
| GC | 8.78% | 短生命周期对象回收 |
| Installer.resolve | 4.66% | 解析安装目标 |
| jsdom CSSStyleProperties install | 3.01% | jsdom 原生接口安装 |

源码：`src/engine/jsdom.ts` 的 `open`、`Installer.install`、`constructable`、`applyOrder`。CPU 样本是主线程自身时间分布，不是全部线程 CPU 或线上脚本分布。

## 重复规划与缓存占用

`src/app/planner.ts` 的 `jobForPlanKey` 仅排除 capture interaction seed，其他 Job 字段仍进入缓存键，包括完整脚本。脚本不同会触发重新编译，即使最终安装 Plan 相同。

实际调用同一 Planner：

- 同一请求命中缓存：中位数 0.116 ms。
- 只改变脚本注释，连续 50 次：中位数 16.076 ms，P95 17.679 ms；50 次 Plan ID 完全相同，也与原始 Plan 相同。
- 250 KB 脚本的同请求热规划：中位数 0.365 ms，说明命中后仍需处理完整脚本键，但该成本远小于重复编译。
- 首次规划约 607 ms，包含冷身份/Shape 加载和首次编译；单次观测不适合单独拆解各子阶段。

独立进程只做规划、每阶段两次 GC，并读取缓存对象身份用于诊断：

| 不同脚本累计次数 | 缓存条目 | 不同 Plan ID | 不同 Plan 对象 | GC 后 heapUsed |
| --- | ---: | ---: | ---: | ---: |
| 0（已规划原始请求） | 1 | 1 | 1 | 12.78 MiB |
| 50 | 51 | 1 | 51 | 33.14 MiB |
| 128 | 128 | 1 | 128 | 64.10 MiB |
| 160 | 128 | 1 | 128 | 64.14 MiB |

这不是无限增长的缓存泄漏，但同一安装占满 128 个缓存位置，额外保留约 51.3 MiB 存活堆，同时不断重复编译。编译在父线程进行，多 worker 无法消除该串行开销。

优化应先明确 Feature 对 Job 的实际安装依赖，然后设计缓存键或编译结果共享。不能未经审计直接删除整个 job/code 键：Feature.build 接收 Job，自定义 Feature 可能读取这些字段。按 Plan ID 合并对象只能改善重复保留，不能独自消除编译时间。

## RSS、存活堆与生命周期

现有 memory 门禁执行真实 TaskRunner/Engine，负载为创建 iframe 并使用其 OffscreenCanvas。local 与诊断 worker 在不同子进程运行；两侧 isolate 均强制 GC，20 次预热后每 50 次采样，共 300 次。

| 指标 | local | 诊断 worker |
| --- | ---: | ---: |
| 预热后 RSS | 397.67 MiB | 578.20 MiB |
| 300 次后 RSS | 771.31 MiB | 908.36 MiB |
| RSS 峰值增量 | 373.64 MiB | 330.16 MiB |
| 主线程存活堆峰值增量 | 1.83 MiB | 0.036 MiB |
| worker 存活堆峰值增量 | — | 1.22 MiB |
| 全部样本 engineActive | 0 | 0 |

external 基本不变：local 约 4.23 MiB，两 isolate 合计约 7.54 MiB。JS 堆与 external 增量无法解释 RSS 增长；需要进一步定位 V8/native 分配和操作系统驻留行为，不能仅凭这些数字定性为 native 泄漏。

单独延长诊断 worker 至 1000 次，每 100 次双 isolate GC：

| 已完成任务 | RSS | worker heapUsed |
| --- | ---: | ---: |
| 0 | 541.58 MiB | 50.27 MiB |
| 100 | 880.28 MiB | 50.89 MiB |
| 200 | 914.19 MiB | 45.50 MiB |
| 300 | 1073.58 MiB | 51.73 MiB |
| 400 | 1100.44 MiB | 52.01 MiB |
| 600 | 1100.52 MiB | 51.68 MiB |
| 800 | 1100.81 MiB | 51.87 MiB |
| 1000 | 1100.86 MiB | 51.76 MiB |

第 400–1000 次的 RSS 仅增加约 0.42 MiB，出现平台期。它只证明这个固定负载在主动 GC 下出现短期平台，不能推导生产池、不同脚本或闭环网络的长期稳定性。未设置内存预算，memoryGate 状态为 `observed`。

补充对照：仅用原生 jsdom 建窗、加 iframe、关闭，不安装 Mimic，300 次的 RSS 也从约 233.66 增到 605.91 MiB；存活堆从 43.29 到 49.99 MiB，中途存在显著波动。这说明 RSS 现象至少可在底层路径复现，并非只有 Mimic 特有的安装逻辑能触发。此对照没有 OffscreenCanvas、安装操作或相同 HTML，不应用来相减计算 Mimic 独有内存。

生产 WorkerExecutor 路径的进程 RSS（MiB），500 个无 iframe 的轻量任务：

| 阶段 | 1 worker | 4 workers |
| --- | ---: | ---: |
| 模块导入后，尚未执行 | 81.48 | 81.25 |
| 首任务完成（仅启动一个 worker） | 328.36 | 307.13 |
| 100 次后 | 800.53 | 1417.78 |
| 300 次后 | 927.16 | 1829.00 |
| 500 次后 | 1251.84 | 2229.16 |
| 空闲 1 秒后 | 1251.84 | 2112.27 |
| destroy + 主线程 GC 后 | 1223.47 | 1994.97 |

主线程 heapUsed 约 13.2–13.5 MiB；没有采样生产 worker 的存活堆，因此不能据此判断 worker 堆是否泄漏。主线程 GC 不会替代 worker GC。所有 worker 都确已 terminate，但 RSS 未立即恢复，不能把周期性替换 worker 当作已验证的 RSS 治理办法。若需要硬内存边界，应验证子进程级轮换或根本分配优化的效果。

现有 leak 门禁：2 轮，每轮 local 与 worker 各 20 次，另有超时替换和恢复任务。15 项检查全部通过：`engineActive=0`、active/queued/idle 均为 0、created=terminated=2、live=0、子进程自然退出且 exitCode=0。这覆盖生命周期清理，不覆盖内存预算。

## Capture、队列和 flow 的资源放大

`src/runtime/capture.ts` 每次 poll 都调用完整 `runtime.report()`，只为了更新 POST 数和 pending 时也会生成 trace。报告经过 Realm report、Session 聚合及 JSON 复制。trace 动态代码与 net posts 在单任务内持续累积。

使用真实 Application/Engine 捕获，预先完成规划，deadline=500 ms、poll=10 ms、maxPosts=1；包装 report 方法只用于统计耗时：

| 合成负载 | 完成耗时 | report 次数 | report 累计耗时 | 最终 POST 数 |
| --- | ---: | ---: | ---: | ---: |
| 没有 POST | 564.48 ms | 49 | 3.97 ms | 0 |
| 200 次 eval，无 POST | 531.60 ms | 45 | 44.42 ms | 0 |
| 同步 1000 次 beacon | 43.06 ms | 3 | 6.58 ms | 1000 |

前两行 CPU 时间分别约 72/96 ms，说明 capture 等待时会长期占用 worker 槽位，但不等于 CPU 一直满载。每个 worker 同时执行一个任务，长 capture 的容量受驻留时间约束：并发数 N、平均任务驻留 T 秒时，理论上限约 N/T 次每秒，仍需扣除其他成本。

`maxPosts` 是 capture 循环的完成阈值，不是收集器硬上限：同步脚本执行完才检查完成条件，实测设 1 仍返回 1000 条。不能把它当作报告内存预算。改变此行为需要明确是否允许截断，不能为了优化静默丢弃捕获证据。

其他静态边界：

- `src/executor/worker-pool.ts` 默认最多 4 workers、排队 100。队列按任务数量限制，完整请求先 structuredClone，未按脚本/HTML/布局字节数限额；大请求或多个池会放大内存。
- watchdog 从 worker 的 started 消息开始；排队和父线程规划不在其中。总响应时间可能明显超过 execution timeout。
- Planner 的 Catalog 上限 32、Plan 上限 128；每个 worker 的 Plan 上限 128。命中 worker 缓存后只传 Plan ID，避免重复传输约 659 KiB 的测试 Plan，这条优化已经有效存在。
- `flow/capture.ts` 的 CapturePool 默认每池 size=1，离线模式缓存最多 8 种配置的 executor；配置变化会增加同时保留的池。闭环 capture 的 executor 每次创建并销毁，不共享缓存，且此类并发没有该 8 配置上限。
- 独立调用 `captureBodies` 而不传共享池时，也会每次创建和关闭池。短任务容易被冷启动成本主导；闭环复用需保持 cookie/callback 的任务隔离。

## 优化顺序与验收建议

1. **先修规划缓存的重复工作。** 已同时复现约 16 ms 重复编译和约 51 MiB 重复存活堆。按安装依赖规范化键，保留自定义 Feature 语义；验证只改脚本时的缓存命中、同 ID 对象共享，以及真正影响安装的字段仍正确失效。
2. **把 RSS 预算作为部署约束单独解决。** 当前生产短测单 worker 已超过 1.2 GiB、4 workers 超过 2.1 GiB；这些是观测值而非通用最低配置。以实际脚本、队列、并发和目标 OS 测量峰值、空闲后驻留及重启效果，再确定池大小、任务字节限额和进程轮换策略。
3. **优化 Realm 安装热点。** 优先研究 applyOrder 和 constructable 的重复操作、安装计划可预计算信息和 Realm 内缓存；保留属性顺序、构造语义及子 Realm 合约。不能简单跳过安装或跨任务复用全局 Realm，否则可能破坏隔离及反检测语义。
4. **将 capture 状态读取与完整报告生成分离。** 轮询只需增量 POST/pending 状态，结束时再聚合完整 trace；用真实捕获工作流验证 body 顺序、重复 body、闭环响应等待和 trace 内容完全保留。
5. **根据 capture 驻留时间限制入口并发。** 复用已支持的离线池，限制池配置组合；为总耗时/排队观测和任务字节量建立预算。闭环执行器复用属于额外设计工作，不能直接套用离线复用。

磁盘抽查：node_modules 69 MiB、dist 14 MiB、build 15 MiB、resources 8.5 MiB、reference 9.8 MiB、test 876 KiB、.git 41 MiB。当前没有生产身份库，热规划约 0.12 ms；本次没有证据表明磁盘容量或热路径文件检查是主要瓶颈。大量身份的首次索引，以及真实 HTTP/freq-js 网络资源尚未量化。

## 复跑

```sh
npm run build
node dist/src/quality/bench.js --profiles android-webview/unknown-v138-1 --profiles-root test/fixtures/fp-env --iterations 60 --warmup 10 --rounds 3 --pool-size 1
node dist/src/quality/bench.js --profiles android-webview/unknown-v138-1 --profiles-root test/fixtures/fp-env --iterations 60 --warmup 10 --rounds 3 --pool-size 4
node dist/src/quality/leak.js --profile android-webview/unknown-v138-1 --profiles-root test/fixtures/fp-env --tasks 20 --worker-size 1
```

memory CLI 没有 profilesRoot 参数，默认从当前目录的 `profiles` 加载。本次在 `/tmp/mimic-resources.DCU5md` 下创建 `profiles` 符号链接指向仓库测试身份目录，然后执行：

```sh
cd /tmp/mimic-resources.DCU5md
node /Volumes/WorkDisk/dev/projects/work/web_reverse/mimic/dist/src/quality/memory.js '{"profile":"android-webview/unknown-v138-1","tasks":300,"warmup":20,"sampleEvery":50}' > memory-300.json
node --expose-gc /Volumes/WorkDisk/dev/projects/work/web_reverse/mimic/dist/src/quality/memory.js --child worker '{"profile":"android-webview/unknown-v138-1","tasks":1000,"warmup":20,"sampleEvery":100}' > memory-worker-1000.json
```

额外探针：`node --expose-gc /tmp/mimic-resources.DCU5md/probe.mjs MODE`，MODE 分别为 `phases`、`planning`、`raw`、`capture`、`production 1` 或 `production 4`。`phases` 输出 `realm.cpuprofile`，可在 Chrome DevTools Performance 中加载。临时脚本记录了固定仓库路径，迁移机器需修改路径。

## 第一步完成：规划缓存按安装依赖复用

2026-09-10，在上述基线后完成实现：

- `Feature.jobKeys` 声明 build 和 describe 读取的顶层 Job 字段；`[]` 表示不读取 Job，省略则使用完整 Job，包含 interaction seed。
- 审计全部 16 个内置 Feature：net 依赖 kind，trace 依赖 trace，其他 Feature 不依赖 Job。编译器自身始终将 kind 纳入键，因为它写入 Plan.task。
- Planner 根据当前选中 Shape 所使用的 Feature 合并字段依赖；完整 Job 仍先校验，再查询缓存。执行端仍使用每次任务的完整 Job。
- Catalog 复制并冻结依赖声明；声明仅用于缓存，不进入 Catalog/Plan 身份。未改变 Engine ABI、Plan 或 wire schema。
- 没有按 Plan ID 全局合并 Compilation，因为自定义 describe 可以在 Plan ID 相同的情况下产生不同能力报告。

同机、同夹具、同临时脚本复测：

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 50 次只改变脚本注释的规划中位数 | 16.076 ms | 0.027 ms |
| 上述规划 P95 | 17.679 ms | 0.051 ms |
| 250 KB 脚本重复请求的规划中位数 | 0.365 ms | 0.024 ms |
| 160 个脚本变体后的缓存条目/Plan 对象 | 128 / 128 | 1 / 1 |
| 上述纯规划进程 GC 后 heapUsed | 64.14 MiB | 12.93 MiB |
| 上述纯规划进程 RSS | 298.19 MiB | 162.61 MiB |

修改后纯规划基线 heapUsed 为 12.79 MiB，160 个变体后仅增约 0.13 MiB；相对修改前少约 51.2 MiB 存活堆。时延差异只表示该规划微基准的收益，不等于完整任务或线上 flow 的加速倍数。Realm 安装和生产长期 RSS 的问题仍需独立处理。

验证证据：

- `npm test`：337/337 通过。新增回归覆盖 160 个变体只编译一次、自定义 build 的完整 code/seed 依赖、自定义 describe 的能力报告隔离；更新 Application 测试验证共享安装仍执行不同脚本并拒绝非法 Job。
- `npm run check` 通过：类型检查、13 个 Shape 产物检查和数据检查。
- 修改前保存的六组 run/capture/diagnose/probe（包括 trace 和 interaction 变体）Plan ID 与能力报告 hash 全部保持一致。原始身份对照为临时目录中的 `planner-before.json`。
- 通过生产 SDK/WorkerExecutor 顺序运行 160 个不同 code/timeout 的任务，确认 Plan 对象复用且返回值逐次正确；两次 capture 改变 scriptUrl、timeout、adapter 和 seed，确认同一安装分别捕获正确的 currentScript URL。最终 created=terminated=1、live=0。
- 本次复测文件：临时目录中的 `phases-after.json`、`planning-after.json`、`cache-tests.log`、`cache-check.log`。再次执行 phases 探针会覆盖临时 `realm.cpuprofile`。
