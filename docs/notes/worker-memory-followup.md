# 生产 worker 内存归因与预算实验

基线提交：`e7bf319`（规划缓存按 Feature 的 Job 依赖复用）。采样时间：2026-09-10 UTC / 2026-09-11 UTC+8。前一阶段见 [资源分析](resource-usage-analysis.md)。

结论：当前轻量负载的主要增长来自 **默认 GC 下尚未回收的 Realm/V8 堆，以及回收后仍驻留的匿名页与 malloc 分配区**。强制 GC 后旧 Realm 可以全部消失，未发现这个负载持续保留 Realm 的证据。线程退出不稳定地降低 RSS；子进程退出才提供进程私有内存的完整回收边界。减小 V8 堆上限可以提前触发 GC，但它不是 RSS 上限，且增加 CPU 成本。

## 方法与范围

新增 `scripts/probe-worker-memory.mjs`，直接调用生产 `WorkerExecutor`。脚本通过 JS 可见的私有 pool/slot 读取真实 Worker，再调用 Node 24 的 `getHeapStatistics()`、`cpuUsage()` 和可选的 `getHeapSnapshot()`；没有向 SDK、worker 协议或运行实现添加诊断接口。

- 机器：Apple M4、10 逻辑核、32 GiB、macOS 26.6.2 arm64、Node 24.12.0、jsdom 29.1.1。机器非独占；结束时系统 memory free percentage 为 50%，已使用 swap 约 3.31 GiB。
- 身份：`test/fixtures/fp-env` 的 `android-webview/unknown-v138-1`。没有生产 fp-env 库或真实 sensor。
- fixed：`1 + 1`；vary：每次只改变注释；capture：`eval('1 + 1')` 后 20 ms 定时发送一个 beacon，开启 trace，poll=10 ms、deadline=500 ms、maxPosts=1，离线捕获。
- 每轮总共预热 20 次，然后每批并发提交 100 个任务；单 worker 时实际执行串行，4 workers 时由生产池调度。每批结束记录主线程和所有 worker 的堆统计；默认不主动 GC。
- 一般空闲观察 5 秒；轮换实验及 2000 次长测使用 1 秒。执行耗时包含批次采样与小型 JSON 写入，不包含预热、空闲、vmmap 或堆快照。
- 表中 RSS 为整个 Node 进程，不能按 worker 相加。早期实验记录的是批次/空闲采样最大值，可能漏过短峰；后续脚本增加 `process.resourceUsage().maxRSS`，系统高水位单独列出。
- vmmap 和堆快照是侵入性诊断。快照会触发 GC、暂停 worker 并产生额外分配；带快照的 RSS 和时序不能直接作为生产基准。
- 各组负载串行运行，每组单次观测。小幅时延差异不能视作稳定性能收益。

## 默认生产池的表现

| 工作负载 | workers | 测量任务数 | 执行耗时 | RSS 采样峰值 | 空闲后 RSS | destroy 后空闲 RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| fixed | 1 | 1000 | 17.84 s | 2371 MiB | 2195 MiB | 597 MiB |
| vary | 1 | 1000 | 17.74 s | 2249 MiB | 2249 MiB | 2111 MiB |
| capture | 1 | 500 | 19.77 s | 908 MiB | 908 MiB | 883 MiB |
| fixed | 4 | 1000 | 5.99 s | 3353 MiB | 3219 MiB | 3050 MiB |

fixed 组额外执行了 vmmap；其余三组没有。fixed/vary 的编译成本已经基本相同；RSS 差异不能归因于脚本变化导致缓存重新膨胀，也不能单凭两组线程退出的差异判断不同代码的回收行为。

单 worker fixed 的关键样本：

| 已完成任务 | worker heapUsed | V8 native contexts | 进程 RSS |
| --- | ---: | ---: | ---: |
| 预热后 | 178.77 MiB | 21 | 451.5 MiB |
| 400 | 1188.56 MiB | 313 | 1502.0 MiB |
| 500 | 394.11 MiB | 72 | 1865.8 MiB |
| 1000 | 1628.65 MiB | 572 | 2371.2 MiB |
| 空闲 5 秒 | 1628.65 MiB | 572 | 2194.5 MiB |

`native contexts` 包含 worker 自己的基础 context；该负载每个任务新建一个 Realm。这里的数量表示尚未被 V8 回收的 context，不等于仍在执行的 Runtime。样本中队列及 active 均为 0，所有 `number_of_detached_contexts` 为 0。

第 400–500 次之间，worker 堆从约 1189 降到 394 MiB，但进程 RSS 继续增加，说明“对象回收”和“驻留页归还”是两个不同过程。主线程堆只在约 15–62 MiB 之间波动；worker external 基本保持约 5.27 MiB。默认实际 `heap_size_limit` 为 **4288 MiB/worker**，为短命 Realm 的延迟回收留下很大空间。

capture 在定时器等待期间会给 GC 更多运行机会，本组合成负载的待回收 contexts 明显较少。但真实 capture 的大脚本、HTML、trace、网络响应及等待时间均可能不同，不能推广为所有 capture 内存更低。

## 堆快照和系统内存映射

独立 fixed 单 worker 快照实验，在预热后及 1000 次后分别获取一次真实 worker 堆快照：

| 阶段 | worker heapUsed | native contexts | RSS |
| --- | ---: | ---: | ---: |
| 预热，快照前 | 178.84 MiB | 21 | 446.0 MiB |
| 预热，快照 GC 后 | 45.52 MiB | 1 | 437.6 MiB |
| 1000 次，快照前 | 303.41 MiB | 92 | 2435.5 MiB |
| 1000 次，快照 GC 后 | 50.66 MiB | 1 | 571.3 MiB |

该组中间的堆峰值曾达 1782 MiB。前后快照节点数从 474,668 降到 460,792，节点 self-size 总和从 50.84 增到 55.98 MiB；最大的正向增量是 V8 code/TrustedByteArray 等编译元数据。快照 self-size 与 getHeapStatistics 的 heapUsed 口径不同，不能直接相等比较。

证据支持：这个固定负载的历史 Realm 可被 GC 清除；回收后的约 5.14 MiB 堆增量主要落在代码及内部元数据类别，而不是越来越多的 Realm。尚未取得任何 native 分配栈，因此不对具体 C++ 分配函数或“native 泄漏”下结论。

macOS `vmmap -summary` 显示：

- 默认 fixed 1000 次时 physical footprint 约 2.3 GiB，其中 `Memory Tag 255` 匿名内存 resident 约 2.0 GiB，是主要部分；malloc resident 约 264.6 MiB。
- 该组线程退出后 physical footprint 约 610 MiB，匿名页 resident 约 408.8 MiB；malloc allocated 仅约 12.2 MiB，但 resident 约 141.8 MiB，报告的 dirty+swap fragmentation 为 91%。
- 快照 GC 后的另一组 physical footprint 约 313 MiB，而 Node RSS 约 571 MiB；两者统计口径不同。其匿名页 resident 约 151.8 MiB，malloc resident 约 362.1 MiB。

不能把 `Memory Tag 255` 直接等同于某个库的泄漏；它是 OS 的内存类别。数据证明大量空间落在匿名页和分配区保留，而不是被 external/ArrayBuffer 统计解释。也不能用 RSS、vmmap resident total 和 physical footprint 相减推导精确的 JS/native 分配量。

## 提前触发 GC：V8 堆上限对照

只给实验进程设置 `NODE_OPTIONS=--max-old-space-size=N`，生产代码和默认配置均未改变。该选项也影响宿主主线程，不能视为已经实现的单 worker 独立配置。

实际测得 heap_size_limit：默认 4288 MiB、old-space=256 时 448 MiB、old-space=512 时 704 MiB。old-space 数字不是整个堆上限，也不是 RSS 限额；`worker.resourceLimits` 返回的默认字段不能替代实际 heap_size_limit 验证。

| 工作负载 | workers | old-space | 任务数 | 执行耗时 | RSS 采样峰值 | OS RSS 高水位 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| fixed | 1 | 默认 | 1000 | 17.84 s | 2371 MiB | 未采集 |
| fixed | 1 | 256 MiB | 1000 | 19.45 s | 698 MiB | 未采集 |
| fixed | 1 | 512 MiB | 1000 | 17.08 s | 893 MiB | 893 MiB |
| fixed | 4 | 默认 | 1000 | 5.99 s | 3353 MiB | 未采集 |
| fixed | 4 | 256 MiB | 1000 | 10.01 s | 1542 MiB | 未采集 |
| fixed | 4 | 512 MiB | 1000 | 7.65 s | 2450 MiB | 2481 MiB |
| capture | 1 | 默认 | 500 | 19.77 s | 908 MiB | 未采集 |
| capture | 1 | 256 MiB | 500 | 19.62 s | 597 MiB | 604 MiB |

单 worker 的 256 MiB 配置耗时增加约 9%，进程 CPU 从约 23.81 增到 39.07 CPU 秒。四 worker 的 256 MiB 配置耗时增加约 67%，CPU 从约 29.31 增到 70.32 CPU 秒；512 MiB 配置耗时增加约 28%。不能只看 RSS 降幅忽略 GC 的并发 CPU 成本。

把单 worker、old-space=256 的 fixed 负载延长至 2000 次：

- 执行 44.62 秒，OS RSS 高水位 **787.77 MiB**，每批采样峰值 770.48 MiB。
- 第 500 次之后采样 RSS 大致在 660–770 MiB 波动，末次 713.41 MiB；contexts 保持在个位数至几十个，所有任务成功。
- destroy 后仍约 685.44 MiB。降低堆上限能减少高水位，仍不能保证退出线程后立即释放整个进程驻留。

这比默认堆上限更适合作为内存受限部署的候选参数，但仅是几十秒负载证据，不是长期稳定性验收。

## 线程轮换与进程轮换

相同的 fixed 负载，三轮，每轮预热 20 次后执行 300 次，空闲及关闭后各等待 1 秒。

| 策略 | 第一轮 | 第二轮 | 第三轮 |
| --- | ---: | ---: | ---: |
| 同一宿主内重建 executor，关闭后 RSS | 1110 MiB | 1109 MiB | 1562 MiB |
| 独立子进程，每轮子进程 RSS 采样峰值 | 1219 MiB | 1085 MiB | 1049 MiB |
| 每轮子进程退出后的监督进程 RSS | 48.80 MiB | 49.22 MiB | 49.83 MiB |

子进程均以 0 退出，并用 PID 检查确认已不存在；监督进程没有加载 Planner/Engine。这里证明承载运行时的进程私有映射不会跨轮保留，不代表测量了全系统所有共享页或磁盘缓存的变化。

同宿主复用身份/模块缓存时，新 executor 启动并预热约 0.64–0.92 秒；独立子进程中约 0.91–1.05 秒，另有 Node 进程启动成本。测量批次本身约 5–6 秒。300 次不是推荐的生产轮换阈值，只是用来比较回收边界的实验分组。

## 下一步可采取的配置和实现

1. **保守的试运行从 size=1 开始。** old-space=512 MiB 在本次单 worker 轻量任务中速度与默认接近、RSS 高水位约 893 MiB，可作为吞吐优先的候选；old-space=256 MiB 更省内存，可作为内存优先的候选。还未更改项目默认值。
2. **把堆限制和 RSS 预算分别配置。** 为 worker 增加可选 V8 resourceLimits，并检查实际 heap_size_limit；若启动参数覆盖它，应在诊断中显示有效限制。另行观察整个承载进程 RSS，不能把 V8 heap limit 当作 RSS 限额。
3. **硬回收使用承载进程边界。** 候选策略是预算触发后停止接收新任务、排空在途任务、替换整个执行进程；若存在任务超时则按已有失败契约处理。不能静默丢任务或直接把全部正在执行的 capture 杀掉。该调度实现不在本次诊断中加入。
4. **真实负载验收后再定预算。** 单 worker 256 MiB old-space 的夹具长测高水位约 788 MiB，因此 1 GiB 只能作为这个受控负载的试验预算；512 MiB old-space 可从 1.5 GiB 试验预算开始。它们不是生产最低内存或安全保证。4 workers、长 trace、大 HTML/布局和闭环网络需要重新计算余量。
5. **保留输入和队列字节预算这一缺口。** 当前 maxQueue 仅按任务数限制；单任务的 code、HTML、trace 和网络体仍可能突破上述夹具成本。没有真实 sensor 时不应直接把这些实验值固化为默认阈值。

本次没有修改运行引擎、GC 行为、池默认大小或协议。新增脚本的实际执行已覆盖固定/变化脚本、capture、1/4 workers、快照、vmmap 和两种轮换；`node --check`、`git diff --check` 通过。没有为纯诊断脚本新增单元测试，也未重复修改前已通过的 337 项功能测试。

## 复跑和原始文件

先 `npm run build`，随后串行执行，避免并行负载干扰：

```sh
node scripts/probe-worker-memory.mjs '{"out":"/tmp/mimic-rss-fixed","workload":"fixed","tasks":1000,"maps":true}'
node scripts/probe-worker-memory.mjs '{"out":"/tmp/mimic-rss-vary","workload":"vary","tasks":1000}'
node scripts/probe-worker-memory.mjs '{"out":"/tmp/mimic-rss-capture","workload":"capture","tasks":500}'
node scripts/probe-worker-memory.mjs '{"out":"/tmp/mimic-rss-four","workload":"fixed","tasks":1000,"size":4}'
node scripts/probe-worker-memory.mjs '{"out":"/tmp/mimic-rss-fixed-snapshot","tasks":1000,"snapshots":true,"maps":true}'

NODE_OPTIONS=--max-old-space-size=256 node scripts/probe-worker-memory.mjs '{"out":"/tmp/mimic-rss-limit256-long","tasks":2000,"idleMs":1000}'
NODE_OPTIONS=--max-old-space-size=512 node scripts/probe-worker-memory.mjs '{"out":"/tmp/mimic-rss-limit512","tasks":1000}'
NODE_OPTIONS=--max-old-space-size=256 node scripts/probe-worker-memory.mjs '{"out":"/tmp/mimic-rss-four-limit256","tasks":1000,"size":4}'
NODE_OPTIONS=--max-old-space-size=512 node scripts/probe-worker-memory.mjs '{"out":"/tmp/mimic-rss-four-limit512","tasks":1000,"size":4}'

node scripts/probe-worker-memory.mjs '{"out":"/tmp/mimic-rss-thread-rotation","tasks":300,"cycles":3,"idleMs":1000}'
node scripts/probe-worker-memory.mjs '{"out":"/tmp/mimic-rss-process-rotation","tasks":300,"cycles":3,"idleMs":1000,"processes":true}'
```

脚本要求支持 Worker 堆统计接口的 Node 24；默认使用测试身份，可通过 profile/profilesRoot 覆盖。输出目录包含 `report.json`、可选 vmmap 文本和堆快照；processes 模式包含各子进程的独立报告。工具失败时 vmmap 错误写入独立文件，不会伪造内存映射。

本次原始输出保存在上述 `/tmp/mimic-rss-*` 目录，以及 `mimic-rss-limit256`、`mimic-rss-capture-limit256`。这些文件未纳入 Git，可能被清理。单 worker 512 MiB 实验目录曾由 `mimic-rss-four-limit512` 更名为 `mimic-rss-limit512`，其旧报告 config.out 保留旧值；实际 config.size=1，应以 size 和本文命令为准。关键数值已保存在本文。
