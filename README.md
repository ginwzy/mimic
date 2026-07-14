# mimic

基于 **jsdom** 的 Chromium 可观察环境回放框架。mimic 用真机采集的 `Profile` 与 `Shape` 编译不可变
`Plan`,在一次性的隔离 Realm 中执行 JavaScript,面向浏览器环境复现、请求体捕获和反检测差分。

```text
Capture -> Profile
Probe   -> Shape

Profile + Shape + Page + Job -> Plan -> Engine -> Runtime -> Result
```

包入口和 `mimic` 命令使用同一套稳定运行时。

## 快速开始

要求 Node.js `^20.19.0`、`^22.13.0` 或 `>=24.0.0`。

```bash
npm install mimic
```

```js
import { createMimic } from 'mimic';

const mimic = createMimic({ profile: 'chrome-mac' });

try {
  const result = await mimic.run({
    kind: 'run',
    code: '({ ua: navigator.userAgent, width: screen.width })',
  });

  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  console.log(result.value);
} finally {
  await mimic.close();
}
```

```bash
# 在目标环境中执行脚本
mimic run script.js --profile chrome-mac

# 捕获脚本通过 fetch/XHR/sendBeacon 提交的请求体
mimic capture script.js --profile chrome-mac

# 生成 Plan、运行结构探针、列出内置数据
mimic plan script.js --profile chrome-mac
mimic probe --profile chrome-mac
mimic list profiles

# 执行 HTTP API,默认仅监听 127.0.0.1:3000
mimic serve

# 真机采集服务,默认监听 0.0.0.0:8970 并写入 ./mimic-data
mimic collect
```

SDK、CLI、HTTP 路由、采集产物与全部参数见[《v2 使用指南》](docs/v2-usage.md)。

## 核心概念

| 概念 | 含义 |
|---|---|
| **Capture** | 真机原始证据,按内容寻址且只追加 |
| **Profile** | 一次采集内保持相关性的设备身份数据 |
| **Shape** | 浏览器版本、平台与宿主的可观察结构 |
| **Page** | URL、HTML、cookie、网络和时钟等页面上下文 |
| **Job** | `run`、`capture`、`probe` 或 `diagnose` 任务 |
| **Plan** | 完整校验后生成的纯数据安装计划 |
| **Engine / Runtime** | 底层适配器与完成原子安装的一次性执行环境 |
| **Result** | JSON 安全的成功值或带稳定阶段/错误码的失败结果 |

Profile 负责 UA、屏幕、GPU 等身份值;Shape 负责属性归属、描述符、函数形态、原型链、键序和接口
有无等结构事实。手工组合不匹配的 Profile/Shape 必须显式设置 `synthetic`,结果也会永久保留该标记。

## 公共入口

| 入口 | 用途 |
|---|---|
| `mimic` | 稳定 SDK:`createMimic`、`run/capture/plan/list` 与公共数据类型 |
| `mimic/http` | 执行 HTTP 服务的 `startServer` |
| `mimic/advanced` | 自定义 Engine、Driver、采集存储和迁移等高级接缝 |

默认入口不会暴露 Engine 内部操作或 Shape 安装原语。

## 安全边界

mimic 的 worker watchdog 用于终止超时任务,**不是多租户安全沙箱**。`run`、`capture`、`serve` 会执行
调用方提供的 JavaScript;生产环境应把不可信任务放进独立进程或容器,并在 HTTP 前置层提供认证、TLS、
限流和资源配额。执行服务因此默认只绑定 loopback。

`collect` 为方便真机访问默认绑定所有网络接口,且没有认证;只应在受信网络短时开启,完成采集后立即关闭。

## 开发验证

```bash
npm test
npm run typecheck:v2
npm run check
npm run build:v2
npm run bench:v2
npm run gate:v2:leak
```

## 目录

```text
src/v2/       v2 领域、编译器、Engine、SDK、CLI、HTTP 与采集实现
schemas/v2/   Profile/Shape/Page/Job/Plan/Result/Collect JSON Schema
profiles/     设备身份源语料,由 v2 数据导入器规范化
resources/v2/ Shape、结构探针、真机基线与冻结行为 Oracle
scripts/      构建、数据校验与 Shape 生成工具
test/v2/      单元、集成、安全、性能与发布包契约测试
docs/spec/    架构与运行时契约
```

## License

本项目 MIT。`reference/sdenv` 与 `reference/sdenv-extend` 为 vendored 的第三方参考实现,各自保留其
原始许可证(`reference/sdenv` 为 BSD-3-Clause,见该目录 `LICENSE`),不受顶层 MIT 覆盖。
