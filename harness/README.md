# harness —— L1 结构面 diff(mimic vs 真机)

把 env-fidelity 校验从 **L0 推理 / L1 内部自测** 抬到 **L2 对真机差分**:同一套结构探针在
真机 Chrome 与 mimic realm 各跑一遍,逐字段 diff,真机即 ground truth,差异即泄漏。
(对应 issue `js-sandbox-env-framework-yvq.13`。)

## 为什么需要它

现有自测(smoke / BFS 零泄漏)的判据全来自"我对 Chrome 的认知模型"。认知有偏 → 自测一路绿灯把
错误固化。本工具用真机基线当 oracle,独立于反检测逻辑,是纯基准工具。

验证层级:`L0 推理 < L1 内部不变式 < L2 差分(本工具) < L3 端到端 cookie 闭环(yvq.9)`。

## 三桶分类(灵魂)

| 桶 | 含义 | 处置 |
|---|---|---|
| **TELL** | 两侧都有此键、但形态不同(name/length/native/描述符/原型链/类型错配) | **唯一默认 fatal** —— 可被检测器识破的"谎言" |
| **MISSING** | 真机有、mimic 无 | jsdom 天生缺几百 API(yvq.6),覆盖缺口,**永不阻断 gate** |
| **EXTRA** | mimic 有、真机无 | 沙箱构件/过度补丁(可能泄漏),仅在 `complete` 基线判定 |
| **INFO** | 两侧相等或良性值差 | 默认隐藏(`--verbose` 可见) |

把"jsdom 天生贫瘠"(MISSING)与"有键但形态错"(TELL)分开,避免一墙红噪声淹没真正的 tell。

## 用法

```bash
# 用种子基线(sdenv 真机 Chrome 函数表)比对 chrome-mac —— 开箱即跑
npm run diff -- chrome-mac
node entry/cli.js diff chrome-mac --t1        # 只就 T1 已修目标判 gate(.13 验收口径)
node entry/cli.js diff chrome-mac --verbose   # 含 INFO + 逐条 MISSING
node entry/cli.js diff --json                 # 机器可读(摘要 + entries),供 CI

# 采真机全量基线(目标设备访问后落盘 harness/baselines/<name>.json)
npm run baseline                              # 起服务,手机/桌面 Chrome 访问
node entry/cli.js diff chrome-mac --baseline mac-chrome-v131   # 用真机基线比对
```

gate:未白名单的 TELL(或 fatal 的 EXTRA)→ 退出码 1;MISSING 永不阻断。

## 文件

```
probe.js        结构探针(零依赖 IIFE,真机/mimic 两侧同源运行;window.__probe__() → 快照)
diff.js         纯 diff 引擎(三桶分类 + 字段级部分基线 + whitelist 降级 + gate)
whitelist.js    已知未修 divergence → issue 规则(yvq.11/.12/.6/.2),规则即数据
baselines/      真机基线 JSON;chrome-mac-seed.json = sdenv 真机函数表烘成的种子(partial)
mimic-snapshot.js  在 mimic realm 内跑 probe 取快照
index.js        runDiff 编排 + 报告格式化
server.js + page.html  真机基线采集(复用 capture 传输模式)
```

## 边界

- diff 只能比"你想到去探的属性",想不到的仍会漏。
- 种子基线只覆盖 window 函数(`complete:false`,字段级 partial)—— 对象/原型的全量结构需真机采集。
- 对黑盒对手,唯一完备 oracle 仍是 L3(cookie 被目标服务器接受)。本工具只做风险下降,不替代 yvq.9。

## 探针字段(结构 tell 全集)

函数:`name / length / toStringNative / toStringSrc / hasOwnToString / hasPrototype / ownNames`。
对象:`tag(Symbol.toStringTag) / protoChain / ownKeys(枚举顺序) / symbolKeys / 每键描述符 flags + data/accessor + 访问器 get/set 的同套函数 tell`。

只采结构,不采身份值(UA/platform 串由 `profile.validate()` 守自洽,不在结构 diff 范畴)。
