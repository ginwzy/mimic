# mimic 使用指南

本指南覆盖稳定 SDK、命令行、执行 HTTP API 与真机采集服务。`mimic` 包入口和命令使用同一套运行时。

## 任务选择

| 目标 | SDK | CLI | HTTP |
|---|---|---|---|
| 执行脚本并返回值 | `run` | `run` | `POST /run` |
| 捕获 fetch/XHR/sendBeacon 请求体 | `capture` | `capture` | `POST /capture` |
| 查看安装计划 | `plan` | `plan` | - |
| 列出 Profile/Shape/Feature/Driver | `list` | `list` | `GET /profiles` |
| 运行结构探针 | 高级入口 | `probe` | `POST /probe` |
| 诊断动态代码与缺失面 | 高级入口 | `diagnose` | `POST /diagnose` |
| 对比真机结构基线 | - | `diff` | - |
| 从真机生成 Capture/Profile/Shape | - | `collect` | 独立采集服务 |
| 提供执行服务 | `mimic/http` | `serve` | - |
| 执行 supplier 请求流程 | `mimic/flow` | - | - |

`capture` 与 `collect` 是不同任务：前者在模拟 Runtime 中运行脚本并记录出站请求体;后者让真实浏览器
访问采集页,保存不可变的设备身份与结构证据。

## SDK

### 创建与关闭

```js
import { createMimic } from 'mimic';

const mimic = createMimic({
  profilesRoot: './profiles',
  profile: 'android-chrome/23049pcd8g-v148-1589412',
  size: 2,
  timeoutMs: 5_000,
  maxQueue: 100,
});

try {
  // run / capture / plan / list
} finally {
  await mimic.close();
}
```

一个 client 持有 worker 池。应复用 client,并始终调用 `close()`;重复关闭是安全的。

常用创建参数：

| 参数 | 默认值 | 含义 |
|---|---:|---|
| `profile` | 无 | 执行任务必须指定本地 fp-env ID;仅 list/close 可省略 |
| `profilesRoot` | 当前工作目录的 `./profiles` | 本地数据根目录,包含 `_fp-env` 子目录 |
| `size` | 最多 4 个 worker | 按需启动的最大并行 worker 数 |
| `timeoutMs` | `5000` | worker watchdog;设为 `null` 可关闭 |
| `maxQueue` | `100` | 所有 worker 忙碌时允许等待的任务数 |
| `page` | Profile 自带 Page | 按字段覆盖 URL、HTML、cookie、网络、时钟或 Performance 资源;省略字段继承 Profile Page |
| `shape` | Profile 引用的 Shape | 显式 Shape;不匹配时还须设置 `synthetic: true` |
| `require` | 无 | 按能力声明最低 Support 等级 |
| `capture` | 见下文 | 请求捕获的等待时间、轮询间隔和目标 POST 数 |

`shapesRoot`、`probePath` 保留结构资源和探针路径配置;`profilesRoot` 不再指向包内设备库。

### 唯一数据源 fp-env

`profiles/generate.mjs` 下载的原始 `z__env` 文件会写入 `profiles/_fp-env/<platform>_<version>/`。该目录是
本地 raw cache,默认被 Git 和 npm 构建排除。运行时只索引这些文件,不再读取旧 Profile JSON 或解析
`meta.extends`,也不会回退到内置设备。以下下载只在准备数据时执行,Plan 编译和 capture 不联网取数据：

```bash
node profiles/generate.mjs --startAfterId 1589411 --limit 100
npm run build
node dist/src/cli.js list profiles --profiles ./profiles
```

生成的 ID 采用 `<platform>-<host>/<model>-v<version>-<recordId>`。必须从 list 结果选择已存在的 ID;
下面仅为示例。数据根目录应是 `_fp-env` 的父目录：

```js
const mimic = createMimic({
  profilesRoot: './profiles',
  profile: 'android-chrome/23049pcd8g-v148-1589412',
});
```

raw 数据在主线程按需规范化成内存 Profile/Page/Shape。原始采集字段标记为 `captured`;缺失但可由 Chromium
合同确定的 `navigator.vendor`、`cookieEnabled` 标记为 `derived`;当前无法可靠映射的 Audio、Canvas 和字体
数据保持 `unsupported`。未知版本的 Shape 从 Feature 表生成并标记为 `derived`,不会冒充真机结构采集。

空目录的 `list profiles` 返回空数组,执行缺失 ID 会报 `BAD_PROFILE`。SDK 不再默认使用 `chrome-mac`;
未指定 profile 的执行请求会报错。ANA/Cebu 可以从非空 Android Chrome raw 池随机选取,池为空直接报错。
构建、npm 安装和测试不要求私人 raw 缓存存在;测试使用独立夹具,包内不分发设备身份数据。

### run

```js
const result = await mimic.run({
  kind: 'run',
  code: '({ language: navigator.language, dpr: devicePixelRatio })',
  scriptUrl: 'https://example.test/challenge.js',
  timeout: 1_000,
  trace: true,
});

if (result.ok) {
  console.log(result.value, result.plan, result.support);
} else {
  console.error(result.error.phase, result.error.code, result.error.message);
}
```

Job 的 `timeout` 限制同步求值;client 的 `timeoutMs` watchdog 还会覆盖求值后的死 microtask。`trace: true`
会在 `report` 中附加访问诊断。返回值和报告必须可编码为 JSON;序列化失败会返回 `ENCODE_FAILED`。

### capture

```js
const result = await mimic.capture({
  kind: 'capture',
  code: `navigator.sendBeacon('/telemetry', JSON.stringify({ event: 'ready' }))`,
});

if (result.ok) {
  console.log(result.value.captured); // 第一个非空请求体
  console.log(result.value.posts);    // 全部捕获记录
}
```

`capture` 支持 `fetch`、`XMLHttpRequest.send` 和 `navigator.sendBeacon`。创建 client 时可用以下选项调整
异步请求等待：

```js
const mimic = createMimic({
  capture: {
    deadlineMs: 1_000,
    pollMs: 10,
    maxPosts: 1,
    lifecycle: 'auto', // 'none' 时不由 mimic 主动派发页面生命周期事件
  },
});
```

`capture` Job 可选择内置交互策略。省略 `interaction` 等同于 `adapter: 'none'`。`seed` 不参与
Plan 缓存键；相同 `seed` 可重复生成相同事件序列。

```js
const result = await mimic.capture({
  kind: 'capture',
  code: sensorSource,
  scriptUrl: sensorUrl,
  interaction: { adapter: 'akamai-sensor', seed: 'optional-replay-seed' },
});
```

`akamai-sensor` 在首个非空请求后派发一次联合建模的 swipe；无请求进展时在 120ms 触发 fallback。
随后在 2500ms 派发 tap，在 2700ms 派发 follow-up swipe。事件由 Realm 原生构造器创建，并通过 jsdom
Engine 的内部派发路径呈现 `isTrusted: true`；touch 列表和触点分别保持 Realm `TouchList`、`Touch`
身份。以上语义仍属于模拟结果，不代表操作系统或真实浏览器输入。

swipe 的 motion/orientation/touch 数值由同一个 CSD4CA 匿名低秩样本生成；同一次 capture 还会选择
一个匿名 recording-session 姿态，并让后续 swipe 按真实手势间隔沿该 session 的 pose transition
演化。模型保留校准后的跨流时序、压力和触点面积，不包含参与者标识或单条原始轨迹。tap 没有对应的
CSD4CA sensor 数据，因此保持 sensorless。重新编译需要单独安装
`scripts/csd4ca-requirements.txt`，然后执行：

```bash
npm run generate:interaction-model -- \
  --input /path/to/CSD4CA \
  --output src/interaction/csd4ca.model.ts
```

数据集来源、许可证和改动说明见包内 `NOTICE`。正常构建和运行只使用已生成模型，不读取原始 CSV。

`lifecycle` 默认为 `auto`,兼容原有行为:脚本求值后由 mimic 主动派发尚未完成的
`readystatechange`、`DOMContentLoaded`、`load`,并派发 `pageshow`。设为 `none` 后只等待环境自然产生的
事件和异步任务,不会抑制 jsdom 自身的生命周期事件。

Performance resource 不再由 Runtime 猜测。需要回放 `performance.getEntriesByType('resource')` 时,在完整
Page 数据的 `performance.resources` 中提供 `name`、`initiatorType`、`startTime`、`duration`、
`nextHopProtocol`、三个 body/transfer size 和 `responseStatus`;字段缺省时资源列表为空,Result 中
`perf.resources` 的 Support 为 `unsupported`。

### plan

```js
const plan = await mimic.plan({ kind: 'run', code: 'navigator.userAgent' });
console.log(plan.id, plan.features, plan.support);
```

`plan` 完成与实际运行相同的解析、能力检查和编译,但不创建 Runtime。稳定 SDK 接受 `run` 或 `capture`
Job,用于预检与审计安装计划。

### list

```js
console.log(await mimic.list('profiles'));
console.log(await mimic.list('shapes'));
console.log(await mimic.list('features'));
console.log(await mimic.list('drivers'));
```

### Result 与错误

所有执行任务返回同一个 `Result` 联合类型：

```js
if (result.ok) {
  // value? / report? / plan / support / synthetic?
} else {
  // error: { name, phase, code, message, details?, plan? }
}
```

任务自身的解析、编译、安装、运行和编码失败通常以 `ok: false` 返回。错误的 SDK 调用方式、无法
structured-clone 的输入、队列满或 client 已关闭会拒绝 Promise,应另外用 `try/catch` 处理。

## Flow

`mimic/flow` 在 Node 主线程组合 `@zionsssx/freq-js` 请求和进程内 mimic capture。ANA/Cebu 各自维护
请求协议和执行顺序,不会把真实网络带入 Plan 或 worker。

仓库内可用统一入口快速运行完整 flow。ANA 默认执行 verify，Cebu 默认执行 search：

```bash
npm run flow -- ana none
npm run flow -- ana reqable
npm run flow -- cebu lumi
npm run flow -- ana mitm
npm run flow -- ana lumi --total 20 --concurrency 4
```

Reqable、Lumi 和 mitm 配置分别作为 `flow/run.ts` 中 `runAna()`、`runCebu()` 的局部字面量。每次运行
从 `./profiles` 下可用的 Android Chrome profiles 中随机选择一个 profile。两个 supplier 不共享全局
配置，也不读取环境变量。CLI 将 flow 日志写入 stderr，stdout 只输出不含 cookies 和响应 body 的
JSON 摘要。使用 `npm run flow -- --help` 查看参数。

批量模式通过 `--total` 设置总运行次数、`--concurrency` 设置最大并发数。每个任务独立创建 flow
和代理 session；stderr 使用任务编号前缀输出实时 flow 日志，并在每个任务结束时输出累计成功数、
失败数和成功率。stdout 最后只输出批次统计 JSON。ANA verify 和 Cebu search 的 `2xx`、`401` 都
计为成功；单个任务异常计为失败，不会中断同批其他任务。

也可以从代码直接调用：

```js
import { runAnaFlow } from 'mimic/flow';

const result = await runAnaFlow({
  proxy: 'http://127.0.0.1:9001',
  verify: true,
});

console.log(result.verify?.status);
```

Lumi 认证由调用方传入,helper 会为每次 flow 生成独立 sticky session：

```js
import { createLumiProxy, runCebuFlow } from 'mimic/flow';

const lumi = createLumiProxy({
  customerZone: 'lum-customer-example-zone-gen',
  password: 'password',
  country: 'gb',
});

const result = await runCebuFlow({
  proxy: lumi.url,
  search: true,
});
```

需要由本地 mitm 转发到 Lumi 时,同时传入 helper 生成的 `proxyHeaders`：

```js
import { createLumiRelayProxy, runAnaFlow } from 'mimic/flow';

const relay = createLumiRelayProxy({
  proxyUrl: 'http://127.0.0.1:24800',
  customerZone: 'lum-customer-example-zone-gen',
  password: 'password',
  country: 'gb',
  clientHelloId: 'hellocustom_ios_random',
  http2ProfileId: 'mobile_android',
});

const result = await runAnaFlow({
  proxy: relay.url,
  proxyHeaders: relay.proxyHeaders,
  verify: true,
});
```

ANA/Cebu 的 wire profile 固定为 Chrome 145/Android；`profile` 只控制 mimic 中的 JS/DOM/interaction
环境。两者是独立配置。网络、profile 或 capture 失败会拒绝 Promise；最终 API 的 HTTP 状态保留在
`verify`/`search` 结果中。结果包含完整 cookie 仅用于调用方调试和后续请求,不应直接写入日志。
ANA 执行 verify 前会先用当前会话生成的 cookies 提交固定的 `flight-search` 表单导航请求。

同一进程内重复调用时,可共享捕获池以复用 worker 和编译缓存。每次捕获仍创建独立 Realm;
不同数据目录、deadline 和 maxPosts 使用各自的执行器。调用方必须在全部任务结束后关闭池：

```js
import { CapturePool, runAnaFlow } from 'mimic/flow';

const capturePool = new CapturePool(2); // 每种捕获配置最多两个 worker
try {
  await Promise.allSettled([
    runAnaFlow({ profilesRoot: './profiles', capturePool }),
    runAnaFlow({ profilesRoot: './profiles', capturePool }),
  ]);
} finally {
  await capturePool.close();
}
```

`npm run flow -- ana reqable --total 10 --concurrency 2` 自动在整批任务中共享并关闭捕获池。
不传 `capturePool` 时保持一次性捕获行为。`captureBodies(options, capturePool)` 也可直接复用同一个池。

## CLI

CLI 每次只向 stdout 写一行 JSON。参数错误写入 stderr 的 JSON,失败退出码为 `1`。

### 执行与检查

```bash
mimic run script.js --profile android-chrome/23049pcd8g-v148-1589412
mimic capture script.js --profile android-chrome/23049pcd8g-v148-1589412
mimic diagnose script.js --profile android-chrome/23049pcd8g-v148-1589412
mimic probe --profile android-chrome/23049pcd8g-v148-1589412
mimic plan script.js --profile android-chrome/23049pcd8g-v148-1589412
mimic list profiles
mimic list shapes
mimic list features
mimic list drivers
```

`run`、`capture`、`diagnose` 与 `plan` 各接受一个脚本文件;`probe` 不接受脚本。`list` 省略类别时默认
列出 `profiles`。

这些命令共享以下参数：

| 参数 | CLI 默认值 | 含义 |
|---|---:|---|
| `--profile <id>` | 无 | 执行命令必填的 fp-env Profile ID |
| `--profiles <dir>` | 当前工作目录的 `./profiles` | 本地数据根目录,包含 `_fp-env` |
| `--probe <file>` | 包内探针 | 自定义 probe 脚本 |
| `--pool-size <n>` | `1` | worker 数 |
| `--timeout <ms>` | `5000` | worker watchdog |
| `--max-queue <n>` | `pool-size` | 等待队列上限 |
| `--script-url <url>` | 无 | 脚本来源 URL |
| `--trace [true\|false]` | 无 | 开启或关闭 trace;裸 `--trace` 等同于 `true` |
| `--capture-deadline <ms>` | `1000` | capture 最长等待时间 |
| `--capture-poll <ms>` | `10` | capture 轮询间隔 |
| `--capture-max-posts <n>` | `1` | capture 等待的非空请求数 |
| `--capture-lifecycle <auto\|none>` | `auto` | 是否由 mimic 主动派发页面生命周期事件 |

### diff

```bash
mimic diff android-chrome/23049pcd8g-v148-1589412 --baseline ./android-chrome-baseline.json
mimic diff --profile android-chrome/23049pcd8g-v148-1589412 --baseline ./android-chrome-baseline.json --t1 true
```

`diff` 最多接受一个位置参数作为 Profile;也可使用共享的 `--profile`,两者都省略时报错。
`--baseline` 接受内建 baseline 名或 JSON 快照路径;省略时按同名或唯一前缀
查找。`--t1 true` 只汇总 T1 gate。

输出是标准 `Result`,其中 `value` 为 `{ profile, baseline, summary, entries }`,并用 entries 区分
`TELL`、`EXTRA`、`MISSING` 与其他覆盖信息。差分命令成功执行但 gate 未通过时,`Result.ok` 仍为
`true`,进程退出码为 `1`;自动化应同时检查 `value.summary.gatePass` 或退出码。

### serve

```bash
mimic serve \
  --host 127.0.0.1 \
  --port 3000 \
  --pool-size 2 \
  --timeout 5000 \
  --max-queue 100 \
  --max-body 4194304
```

默认监听 `127.0.0.1:3000`,请求体上限为 4 MiB。服务启动后 stdout 会输出包含 URL 和 executor 状态的
JSON。`SIGINT` 或 `SIGTERM` 会关闭 listener 与 worker。

### collect

```bash
mimic collect --host 0.0.0.0 --port 8970 --root ./mimic-data
```

在待采集的浏览器中打开 `http://<采集机地址>:8970/`。页面会先运行 Shape probe,再采集身份数据并提交;
成功响应和页面文本框会显示 receipt。默认请求体上限为 32 MiB,可用 `--max-body` 调整,`--probe` 可
替换包内探针。

一次完整访问会写入：

```text
mimic-data/
  captures/<hash>.json       原始 Capture,按内容寻址且不覆盖
  profiles/<base64url-id>.json
                              规范化 Profile
  pages/<base64url-id>.json  可选 Page
  shapes/<base64url-id>.json 规范化 Shape
  catalog.json               从全部 Shape 可重复构建的 Catalog
```

这些是 collect 的证据和回归产物,不会被默认 fp-env 加载器当作第二套运行时设备库扫描。
高级调用仍可通过 `ProfileFiles` 显式读取它们进行采集验证。

只有身份与结构两部分证据都存在时才生成派生物;原始 `captures/` 永远不被 normalize 覆写。

## 执行 HTTP API

`mimic serve` 暴露与 worker 相同的 `TaskRequest -> Result` 协议。

| 方法与路由 | 请求 |
|---|---|
| `GET /profiles` | 无请求体,返回 Profile ID 数组 |
| `POST /run` | `{ profile, job: { kind: "run", code, ... } }` |
| `POST /capture` | `{ profile, job: { kind: "capture", code, ... } }` |
| `POST /probe` | `{ profile, job: { kind: "probe", ... } }` |
| `POST /diagnose` | `{ profile, job: { kind: "diagnose", code, ... } }` |

`TaskRequest` 还可带 `page`、`shape`、`require` 和 `synthetic`。URL 与 `job.kind` 必须一致。

```bash
curl -sS http://127.0.0.1:3000/run \
  -H 'content-type: application/json' \
  --data '{
    "profile":"android-chrome/23049pcd8g-v148-1589412",
    "job":{"kind":"run","code":"({ua:navigator.userAgent})","timeout":1000}
  }'
```

```bash
curl -sS http://127.0.0.1:3000/capture \
  -H 'content-type: application/json' \
  --data '{
    "profile":"android-chrome/23049pcd8g-v148-1589412",
    "job":{"kind":"capture","code":"navigator.sendBeacon(\"/t\",\"body\")"}
  }'
```

请求格式错误返回 `400`;未知路由返回 `404`;超过请求体上限返回 `413`;队列饱和返回 `503`。合法任务
即使执行失败也返回 HTTP `200`,失败细节在 `Result.ok: false` 中。

需要嵌入 Node.js 服务时使用专用入口：

```js
import { startServer } from 'mimic/http';

const handle = startServer({
  host: '127.0.0.1',
  port: 3000,
  size: 2,
  timeoutMs: 5_000,
  maxQueue: 100,
  maxBodyBytes: 4 * 1024 * 1024,
});

// 退出流程中调用
await handle.close();
```

真机采集服务不是上述执行 API 的路由。它独立提供 `GET /`、`GET /probe.js`、`GET /identity.js` 与
`POST /collect`,通常应通过 `mimic collect` 启动。

## 安全与部署

mimic 隔离的是每次任务的浏览器 Realm,不是宿主机权限。worker watchdog 可以处理同步死循环和死
microtask,但不能把任意 JavaScript 变成多租户安全负载。对不可信调用方必须增加进程或容器边界、最小
权限、内存/CPU 配额、认证、TLS 和请求限流。

执行服务默认绑定 loopback;不要仅靠 `--host 0.0.0.0` 暴露到公网。采集服务默认绑定所有接口且没有
认证,采集的 UA、屏幕、GPU、时区等数据也可能具有识别性,因此只应在受信网络短时运行并妥善保护
`mimic-data`。

## 高级入口

自定义 Engine/Driver、直接 Application、采集存储和 schema migration 位于：

```js
import { JsdomEngine, WorkerExecutor, CollectStore } from 'mimic/advanced';
```

这些是显式高级接缝,不属于默认入口的最小稳定面。内部 Shape 安装原语不会从 `mimic` 导出。
