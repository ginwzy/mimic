# akavm 与 Mimic 的运行时内存对照

2026-09-11，在本机检查 `/Volumes/WorkDisk/dev/projects/work/akavm` 并运行离线探针。结论：akavm 的专用浏览器环境和每次销毁 isolate 的设计，在本次轻量负载中显著降低了 RSS；不能据此认定两个项目具有相同浏览器能力，或承诺真实 10 并发 flow 的内存只有几十 MiB。

## 架构差异

| 维度 | akavm | Mimic |
| --- | --- | --- |
| JS 宿主 | Rust 直接嵌入 V8，workspace v8 142.2.0 | Node worker_threads + jsdom 29.1.1 |
| 执行隔离 | 每次 Engine.run 创建 isolate/context，结束显式 drop isolate | worker isolate 长期存活，每个任务创建/关闭 jsdom Realm |
| 浏览器环境 | 自定义 JS browser bundle，有限 DOM 与 profile 投影 | jsdom DOM/接口体系，再安装 Shape 和 Feature |
| 并发限制 | Engine clones 共享 RunCapacity；flow concurrency 与 vm_concurrency 分开 | flow CLI 将并发数作为各 capture 配置池的 size |
| 堆约束 | CreateParams.heap_limits(32 MiB, 128 MiB) | 默认运行时有效堆上限约 4288 MiB/worker；可以通过启动参数调小 |
| 安装复用 | 环境源码和 V8 编译字节码在宿主缓存，新 isolate 消费 code cache | Planner/worker 复用 Plan；每个 Realm 仍安装结构与行为 |

akavm 关键实现：

- `crates/akavm-runtime/src/engine.rs:390`：获取 permit 后创建 isolate；删除 EventLoop/PrivateCompletion/ObservationHandle，drop observer、isolate，最后归还 permit。正在销毁的 isolate 也计入 VM 并发预算。
- 同文件 `ScriptCodeCache` / `execute_v8_script_with_cache`：OnceLock 保存字节码，首次编译锁防止重复冷编译；后续新 isolate 使用 ConsumeCodeCache。这是代码缓存，不是共享可变 Realm 或 V8 heap snapshot 恢复。
- `apps/cooker/src/run.rs:121`：所有 flow worker 共享 Engine；`config.concurrency` 与 `config.vm_concurrency` 分别控制业务并发和 VM 容量。
- `crates/akavm-suppliers/src/jetstar/flow.rs:61`：production 配置默认 browser V1，V2 是另一条路径。因此下面保留 V1 和 V2 的独立测量。

128 MiB 是 V8 配置的堆限制参数，不是进程 RSS 上限，也不代表每次预分配 128 MiB。isolate 退出仍可能留下宿主缓存和分配器驻留，但不会把任务的旧 JS 堆交给一个永久存活的 isolate 等待后续 GC。

## 本地探针

硬件沿用 M4、32 GiB；Mimic Node 24.12.0，old-space=512 MiB。通过 `/usr/bin/time -l` 的 maximum resident set size 统计进程高水位，单位转换为 MiB。

akavm Cargo 离线构建因本机缺少 adler2 源码缓存而失败。随后用 rustc 链接现有 `target/debug/deps` 中的 runtime/browser/profile/serde_json rlib 构建独立临时探针；这些 rlib 的生成时间晚于对应 crate 中最新的 RS/JS 文件。这里测的是现有 debug 编译产物，没有重新构建 release，也没有重新验证完整依赖构建。akavm 源码工作树未修改。

akavm V1 探针加载现有 `akavm_browser::bundle()` 与 BrowserSnapshot，目标脚本通过定时器设置完成值。V2 使用 BrowserProgram、专用测试 adapter 和私有完成回调。两者每次都验证输出为 2；20 次预热后测量 1000 次。10 个宿主线程持续补充任务，Engine 的 VM permit 独立设置。

Mimic 探针通过实际 SDK/WorkerExecutor，10 个调用槽位、10 workers，capture 脚本在 20 ms 后 beacon 发送 `String(1+1)`，maxPosts=1、poll=10 ms、deadline=500 ms，trace 默认关闭；同样先预热 20 次，再完成 1000 次并逐次验证 body 为 `2`。关闭池后等待 2 秒。

| 环境 | 调用并发 | VM 容量 | 定时器延迟 | 1000 次测量耗时 | OS RSS 高水位 |
| --- | ---: | ---: | ---: | ---: | ---: |
| akavm V1 browser | 1 | 1 | 0 ms | 5.62 s | 43.3 MiB |
| akavm V1 browser | 10 | 10 | 20 ms | 3.04 s | 91.9 MiB |
| akavm V1 browser | 10 | 4 | 20 ms | 7.47 s | 59.0 MiB |
| akavm V2 browser | 10 | 10 | 20 ms | 2.54 s | 52.5 MiB |
| Mimic capture，old-space=512 MiB | 10 | 10 | 20 ms | 7.12 s | 2742.5 MiB |

这些是近似的环境安装/定时器负载，不是同能力同身份的严格基准：akavm 使用自己的 fixture.json，Mimic 使用 fp-env WebView 夹具；完成协议不同，Mimic 包含 beacon 捕获和轮询；两者环境覆盖及安装对象数量不同。耗时不包含预热和最后的空闲，RSS 高水位包含整个进程寿命。不能把表中比值宣布为迁移后的通用降幅。

未运行 Jetstar/ANA/Cebu 线上流程、真实 sensor、HTTP session/代理、长交互、闭环网络或长时间内存稳定性测试。也未把生产 ABCK/BMS adapter 本身加入 akavm 的 browser 基础负载。因此 91.9 MiB 不代表 10 条完整生产 flow 的内存预算。

## 为什么不能直接替换

akavm 更小的环境是主要设计差异之一：

- V1 `assets/05_document.js` 中的 body.appendChild/removeChild 是空实现，selector 主要查询预先提供的资源列表；部分通用内建也被包装。
- V2 `assets/v2/dom.js` 支持有限的 `link[href]`、`img[src]`、`script[src]` 查询，createElement 主要创建属性容器；没有提供 jsdom 同等级 DOM 树、选择器、iframe Realm 和事件传播语义。
- Mimic 的 Shape 属性顺序、函数构造行为、子 Realm、有限 layout 回放，以及 opt-in 闭环 XHR，都有独立契约。上表没有验证 akavm 对这些契约的兼容性。

所以更低内存不能简单归功于 Rust，也不能通过把 jsdom 原样搬到另一个宿主获得相同数字。关键是更小的浏览器模型、isolate 生命周期和独立 VM 预算。

## 对 Mimic 的参考价值

可以先借鉴的部分：全局 capture/VM 容量与 flow 并发分离；配置和观测有效堆上限；只缓存不可变安装材料，保留每个任务的独立状态。10 个业务并发可以只允许 4–6 个 VM 同时执行，但 capture 等待也占 VM permit，上表的 4 容量示例明确存在吞吐代价。

若目标是让专用 flow 的内存接近 akavm，则需要评估第二个轻量 Engine：直接 V8 或其他可控宿主、每任务销毁 isolate、只提供目标脚本所需并经过验证的浏览器能力。该路径是显式的兼容性工程，不应直接删除现有 jsdom 能力来降低基准数字。应先用同一份真实脚本、身份、页面输入和捕获结果验收，再比较成功吞吐与 RSS。

临时探针源码和输出位于 `/tmp/akavm-memory.mt1QUw/`：Rust `src/main.rs`、`probe`、各组 JSON/time，以及 `mimic.mjs`。未纳入 Git，可能被系统清理。V1 示例命令：

```sh
/usr/bin/time -l /tmp/akavm-memory.mt1QUw/probe 10 10 1000 20 v1
/usr/bin/time -l /tmp/akavm-memory.mt1QUw/probe 10 4 1000 20 v1
NODE_OPTIONS=--max-old-space-size=512 /usr/bin/time -l node /tmp/akavm-memory.mt1QUw/mimic.mjs
```
