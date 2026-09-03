# mimic flow 模块

状态:已实现

## 目标

`flow` 在 Node 主线程组合真实 HTTP 请求和进程内 mimic capture，用 TypeScript supplier flow 替代
Python 与 Node subprocess 桥接。

```text
supplier flow
    +-- supplier request -> RequestClient -> @zionsssx/freq-js
    +-- captureBodies()  -> createMimic().capture()
```

真实网络只发生在 host。`flow` 不改变 Plan、Worker、Realm、Feature 或 Engine，也不允许 Realm 中的页面
脚本访问真实网络。

## 目录

```text
flow/
  public.ts
  run.ts
  client.ts
  capture.ts
  proxy.ts
  suppliers/
    ana/
      request.ts
      flow.ts
    cebu/
      request.ts
      flow.ts
```

`flow` 位于仓库根目录，表示它是构建在 mimic 核心之上的正式模块。`src/http/` 仍表示入站执行服务；
supplier 不放入 `src/` 或 `test/`。

`run.ts` 是仓库内的轻量测试入口，通过 supplier 和 proxy mode 两个位置参数调用现有 flow。每个
supplier 在自己的执行函数内用局部字面量构造代理和凭据，不读取环境变量或共享全局配置；runtime
profile 在每次运行时从 `./profiles` 下的 Android Chrome profiles 中随机选择。该入口不定义新的通用
flow API，也不属于 `mimic/flow` 公共导出。

## 职责

### Request client

`client.ts` 是唯一直接依赖 `@zionsssx/freq-js` 的文件，负责：

- 创建和关闭 Session/Transport。
- 在一个 client 内复用连接池和 cookie jar。
- 应用明确的 browser/OS profile、proxy、proxy headers、timeout 和 TLS 校验选项。
- 为需要精确 wire header order 的请求创建临时 ordered Transport。
- 返回文本 body、状态码、最终 URL 和响应 headers。

HTTP 401、403 等非 2xx 响应正常返回，由 supplier 判断业务含义；网络失败和超时抛出异常。

请求支持三种 cookie policy：

| policy | 行为 |
|---|---|
| `session` | 使用并更新当前 Session cookie jar |
| `none` | 不使用 Session cookie |
| cookie 名称数组 | 从 jar 中筛选并显式发送单个 Cookie header |

ordered 请求关闭 freq-js 默认 headers，避免 emulation 追加不属于捕获合同的字段。代理 headers 配置在
Transport 上，只发送给代理，不转发到目标站。

### Capture

`capture.ts` 构造临时 Page，调用 `createMimic().capture()`，提取非空 POST body，并在 `finally` 中关闭
Mimic client。

- ABCK 必须提供 `interactionSeed`，并使用 `akamai-sensor` adapter。
- BMS 使用原始脚本，不传 interaction seed。
- Profile 列表通过 mimic SDK 获取，不直接扫描 profile 文件。
- assignment probe 属于旧 bridge 的诊断逻辑，不进入正式模块。

每次 capture 创建独立 Mimic client。Page、deadline 和 maxPosts 都是该次 capture 的固定配置，不为复用
worker 修改核心 SDK。

### Proxy

`proxy.ts` 只构造代理 URL 和动态认证信息，不定义 `none/local/lumi/mitm/reqable` 等 CLI 模式。

- `createProxyUrl()` 构造普通代理 URL。
- `createLumiProxy()` 生成每次 flow 独立的 Lumi sticky session。
- `createLumiRelayProxy()` 生成 mitm URL、动态 relay 地址、ClientHello/HTTP2 profile headers 和 Basic relay
  authorization。

Lumi 凭据由调用方传入。密码、Authorization、完整 cookie 和 sensor body 不应写入日志。

### Suppliers

每个 supplier 只有 `request.ts` 和 `flow.ts`：

- `request.ts` 持有 URL、headers、header order、script discovery、credentials、cookie 白名单和状态码含义。
- `flow.ts` 用普通 async 函数表达 landing、ABCK、BMS 和最终 API 请求的顺序。

Flow 成功时返回 profile、interaction seed、cookies、ABCK/BMS 状态和可选的 `verify`/`search` 原始结果。
profile、capture 或网络失败直接拒绝 Promise，不转换为 `ok`、`class`、`error` 等批处理结果字段。调用方
根据需要记录耗时、代理标签或错误分类。

ANA 和 Cebu 各自定义 options、结果与日志。不要增加 `FlowStage`、通用生命周期、站点 adapter、步骤注册表
或 DAG；只有出现稳定且实质相同的第三处实现时，才继续抽取共用逻辑。

## 运行约束

网络指纹和 mimic runtime profile 是两套独立配置：

```text
wire profile: Chrome 145 + Android
runtime profile: android-chrome/...
```

wire profile 控制真实请求的 TLS、HTTP/2 和默认 headers；runtime profile 控制脚本看到的 JS/DOM/传感器
环境，两者不得合并。

每次 supplier flow 创建自己的 RequestClient，因此 cookie jar、连接池和 Lumi sticky session 不跨 flow
共享。ABCK/BMS POST 不自动重试，避免服务端已接收但客户端超时后重复推进 cookie 状态。

`@zionsssx/freq-js` 固定为 `0.1.4`，wire profile 固定为 `chrome_145` 和 `android`。不使用自动漂移的
browser alias。

## 发布

模块通过 `mimic/flow` 导出。默认 `mimic` 入口不加载 freq-js 原生 binding；只有显式导入
`mimic/flow` 时才加载 flow 实现。

公共入口包括 request client、capture、proxy helpers、ANA/Cebu request factories、supplier flows 及其类型。
具体列表以 `flow/public.ts` 为准，避免在文档中重复维护完整接口签名。

## 验收

验收以实际 supplier 流程为准，不新增专用测试文件。当前实现已通过：

- reqable 下 ANA/Cebu 完整请求流程与 wire header/cookie 捕获检查。
- Lumi 和 mitm-to-Lumi 下 ABCK、BMS、sticky session 与最终 API 请求。
- 本地 TCP CONNECT 探针确认 proxy headers 到达代理。
- 项目 typecheck、构建、数据检查和 npm package export 检查。
