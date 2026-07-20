# Cebu Pacific BMS / mimic 工作纪要

**日期**: 2026-07-16 → 2026-07-17  
**仓库**: `mimic`  
**目标站点**: `www.cebupacificair.com` + `soar.cebupacificair.com` availability  
**主入口**: `test/cebu_flow.py` + `test/cebu_capture.mjs`  
**成功判据**: availability **HTTP 401**（边缘 bot 通过 + 匿名 Access Token 过期）  
**403** = 边缘拒（bot / TLS / cookie / 出口 IP 等）

### 当前状态（2026-07-17 末）

| 路径 | 一次过（first-pass）约率 | 备注 |
|------|-------------------------|------|
| **local** `127.0.0.1:7890` | 高（常 3/3～5/5） | 本机直连在 Akamai **白名单**，无 BMS/abck 注入，**不能**当对照 |
| **Lumi** sticky（默认 `country=gb`） | **约 40%～70%**（`-j 10` 常 ~4/10） | 握手多已绿（~0~ + bm_s + multi-id 110 keys），403 多为 **出口/边缘分** |

**不要**用「失败换 sticky 再跑」抬成功率——那与重新跑等价，不反映一次过保真。

---

## 相关 commits（main，由旧到新）

### 会话一：403 → 本地 401（早期）

| Commit | 摘要 |
|--------|------|
| `b8d45a7` | `document.currentScript` / BMS `urlKey` |
| `5e9a602` | Worker / `createObjectURL` / OffscreenCanvas 初版 |
| `4fbc7d2` | Worker blob/data 真执行 |
| `bd22b48` | profile ANGLE 形态 unmaskedRenderer |
| `2180f22` | detached iframe dual-realm + `port.evaluate` |
| `1ea4290` | matchMedia / connection.type / isSecureContext |
| `8729e54` | RTC / canPlayType / memory / SW / permissions / caches + flow 配置 |
| `77cb83b` | **lifecycle 先于脚本** + Android 空 plugins + fonts + TextMetrics → **401** |

### 会话二：Lumi 主路径 + multi-id + TLS/UA（2026-07-17）

| Commit | 摘要 |
|--------|------|
| `78152f6` | matchMedia coarse 修复 + flow：`--proxy local\|lumi`、基线分类、`--json-out` |
| `ad78b15` | **SharedWorker** dual-id 第二表（裸 `onconnect` + port） |
| `653e13a` | Accept-Language 与 profile 语言对齐 |
| `467847c` | **TLS/UA/sensor 钉 Chrome Android 145**（profile + shape + rnet） |
| `a7a8b8d` | （已 revert）Lumi sticky 重试 |
| `f92eb9f` | **删除重试/stagger**，指标回到 first-pass |

---

## 1. 问题与成功定义

### 1.1 业务流程

```
GET select-flight
  → 拉取 abck + BMS 脚本
  → mimic 执行 abck → 多 POST → _abck 至 ~0~
  → mimic 执行 BMS → POST sensor → 巩固 bm_*（尤其 bm_s）
  → POST soar availability（只带 _abck + bm_s）
```

（编排上 abck 先、BMS 后，对齐真机 HAR 时间线。）

### 1.2 出口约定（重要）

| 模式 | 配置 | 说明 |
|------|------|------|
| **直连** `--proxy none` | 无 proxies | 本机 IP 常被白名单 → **无 sensor 脚本**，无效路径 |
| **local** `--proxy local`（**默认**） | `http://127.0.0.1:7890` | Clash/mihomo 等，非白名单，可注入 Akamai |
| **lumi** `--proxy lumi` | Bright Data residential sticky | 生产路径；`--lumi-country` 默认 `gb` |

每个 worker / 每次 flow：**一个 Client = 一个 sticky session**（Lumi username 里带独立 `session-` id）。

### 1.3 成功判据

- **401** + body `Invalid Access Token` = 边缘 bot 过、应用 token 故意过期  
- **403** Access Denied = 边缘拒  
- 指标只认 **一次过**（不重试）

---

## 2. 做了哪些工作

### 2.1 早期（403 → 本地 401）— 摘要

详见 git `77cb83b` 一带。关键杠杆：

1. **lifecycle 在脚本前**（readyState=complete + hasFocus）  
2. **currentScript → urlKey**  
3. **OffscreenCanvas WebGL**  
4. Android 能力面：空 plugins、matchMedia、connection、secure APIs 等  

### 2.2 matchMedia coarse（`78152f6`）

- **现象**：`navigator.maxTouchPoints === 5`，BMS 仍采到 `fine,fine`  
- **根因**：`port.evaluate('navigator.maxTouchPoints')` 在 driver 侧不可靠  
- **修复**：`window.navigator.maxTouchPoints`（`src/features/globals.ts`）  
- 回归测试：`test/globals.test.ts`

### 2.3 multi-id 第二表 / SharedWorker（`ad78b15`）

用 **forge deobf** + **bms-decrypt** 对照 live 脚本与 body：

| 来源 | 键数 |
|------|------|
| 修复前 decrypt `signals` | ~**93** |
| 修复后 | ~**116** |
| assignProbe uniqueKeys | 87 → **110** |
| ANGLE / brands 成对字段 | 2 → **4** |

**根因（deobf）**：第二表在 **SharedWorker(blob)** 里采；主线程：

```text
SharedWorker 且 constructor.name === "SharedWorker"
  → port.start() + port.onmessage
  → status 0 + UA/HE/GPU 第二批
  → 否则 status 260（无 SW）/ 280（超时）
```

Blob 内是裸赋值 **`onconnect=fn`**（非 `self.onconnect=`）。  
`with(self)` 下若 scope 无 `onconnect` 属性，赋值写飞 → connect 永不触发。

**mimic 修复**（`src/features/dom.ts`）：

- 暴露 **SharedWorker** + **port**（start/close/postMessage/onmessage）  
- boot 后派发 `connect`（`ports: [workerPort]`）  
- worker scope **预置** `onconnect` / `onmessage` / `onerror`  
- shapes：`resources/shapes/.../145.json` 等含 SharedWorker slot  

测试：`test/worker.test.ts`（含 bare onconnect）。

### 2.4 TLS / UA / sensor 一体 Chrome 145（`467847c`）

| 层 | 值 |
|----|-----|
| rnet | `Emulation.Chrome145` + `EmulationOS.Android` |
| Wire UA / sec-ch-ua | Chrome/**145** |
| Profile | `android-chrome/2201116sg-v145-10025`（UA/brands/fullVersion=145） |
| Shape id | `chromium/chrome/android/mobile/145`（`generate-shapes` 新增） |

说明：rnet 无 Chrome150；145 为当前可用高版本 pin。  
曾试「只改 wire 到 138、emulation 仍 144」会伤 local 401——**必须 TLS 与 UA 一起改**。

### 2.5 flow 工程（`78152f6` 等）

`test/cebu_flow.py`：

- `--proxy local|lumi|none|mitm|reqable`（默认 **local**）  
- `--lumi-country`（默认 `gb`）  
- `--abck-policy all|edges`（默认 **all**）  
- `--json-out`、结果 `class` 分桶（`ok_401` / `edge_403` / …）  
- Lumi 下 BMS/abck **加长 deadline**  
- Accept-Language 与 profile 语言一致（`en-GB,...`）  

`test/cebu_capture.mjs`：BMS `Object.assign` 探针 + 可选 SharedWorker spy（`tmp/cebu-baseline/bms-assign-*.json`）。

### 2.6 已删除（明确不做）

- **Lumi edge_403 自动换 sticky 整链重试**（`f92eb9f`）  
  一次过成功率才是工程指标；重试 = 换出口重跑。

---

## 3. 关键点（按影响力）

### 3.1 一次过 401 必备

1. 非白名单出口（local 7890 或 Lumi）  
2. lifecycle 先于脚本  
3. currentScript / OffscreenCanvas  
4. Android 能力面（plugins / matchMedia coarse / connection.type 等）  
5. **SharedWorker 第二表**（110+ keys）  
6. abck 到 `~0~` + 真实 `bm_s`（不硬塞）  

### 3.2 Lumi 仍 flaky 的主因（握手已绿时）

1. **住宅出口信誉**（同 sensor 下 403/401 分裂）  
2. 并发 burst（`-j 10` 伤 first-pass）  
3. 残留传感器（`-2`、canvas 短指纹等）— 次于出口  

### 3.3 方法论

- 同脚本、同 `v=` 解密对照（工具：`akamai/web/bms-decrypt`、`forge deobf --target bms`）  
- live id 前缀轮换（`Ey` / `lD` / `PL` / `FK`…），禁止 HAR iV 硬塞  
- profile/shapes 变更后 **`npm run build`**（+ 新 major 时 `npm run generate:shapes`）  

---

## 4. 剩余工作

### 4.1 一次过 Lumi 率

- 出口：zone / country（试 `ph`/`sg`）、池质量  
- 可选：真机 HAR 对照 JA3 与 rnet Chrome145  
- 并发策略：验收用小 `-j` 或串行看 first-pass  

### 4.2 传感器残留

| 形态 | 说明 |
|------|------|
| 部分字段 `-2` | 失败码，真机多为成功态 |
| canvas / cookie 哈希 | 仍可能偏短或 `'n'` |
| 时区/语言 | profile 仍可能 Europe/Bucharest + en-GB（与 PH 航司/真机可再对齐） |
| GPU 型号 | Adreno 619 vs 真机其它型号 |

### 4.3 工程债

- Cebu xb 解密正式合入 forge vendor（现用 `bms-decrypt` 独立库）  
- availability 新鲜 token（当前 401 body 符合 bot-pass 判据）  
- `isSecureContext` 按 protocol 门控  

---

## 5. 如何复现

### 5.1 端到端

```bash
cd /path/to/mimic
npm run build          # profile/shapes 变更后必须
# local（默认 7890，需本机代理在听）
.venv/bin/python test/cebu_flow.py --search --proxy local -j 1

# Lumi first-pass（无重试）
.venv/bin/python test/cebu_flow.py --search --proxy lumi -j 10 --lumi-country gb
```

期望：

- local：高概率 **401**  
- Lumi：看 `search_ok=k/N` 的 **一次过** 比例；失败多为 **edge_403** 且 tilde0+bm_s 仍真  

**不要**硬塞 `bm_s`。

### 5.2 BMS 解密对照

```bash
# 同一次 capture 的 bms.js + url + body
cd /path/to/akamai/web/bms-decrypt
node -e '
const { decryptBody, normalizeCiphertext } = require("./lib/decrypt.js");
const fs = require("fs");
const r = decryptBody({
  bmsSource: fs.readFileSync("bms.js","utf8"),
  scriptUrl: fs.readFileSync("url.txt","utf8").trim(),
  ciphertext: normalizeCiphertext(fs.readFileSync("body_raw.txt","utf8")),
});
console.log(r.ok, Object.keys(r.parsed?.signals||{}).length);
'
```

过程产物示例：`tmp/cebu-baseline/matched/`、`matched-after-onconnect/`（默认不入库）。

### 5.3 反混淆

```bash
cd /path/to/akamai/web/forge
# 将 live bms.js 置 vendor/bms/bms.js + deployment.local.json 后：
node cli.mjs deobf --target bms
# → build/bms/bms.deobfuscated.js
```

### 5.4 关键代码触点

| 区域 | 路径 |
|------|------|
| capture lifecycle | `src/app/index.ts` |
| currentScript / iframe | `src/engines/jsdom.ts` |
| **SharedWorker** / Worker / OffscreenCanvas | `src/features/dom.ts` |
| matchMedia coarse | `src/features/globals.ts` |
| Cebu flow / 出口 / Chrome145 pin | `test/cebu_flow.py` |
| BMS assign 探针 | `test/cebu_capture.mjs` |
| Profile 145 | `profiles/android-chrome/2201116sg-v145-10025.json` |
| Shape 145 | `resources/shapes/chromium/chrome/android/mobile/145.json` |

---

## 6. 当前运行画像（一体钉）

```
PROFILE          = android-chrome/2201116sg-v145-10025
CHROME_MAJOR     = 145
RNET_EMULATION   = Emulation.Chrome145 + Android
默认 --proxy     = local (127.0.0.1:7890)
Lumi             = brd.superproxy.io sticky, country=gb
abck             = 默认 POST 全部 capture body
BMS multi-id     = SharedWorker 第二表已开（~116 signals / ~110 assign keys）
```

**每个 worker 是否同一环境？**

- **是**：同一 profile、同一 UA/TLS pin、同一 capture 逻辑  
- **否（Lumi）**：每个 worker **独立 sticky session = 不同出口 IP**  
- **否（并发）**：多条 flow 并行，互不共享 cookie jar  

---

## 7. 结论

1. **本地 7890 一次过 401 已稳定可复现**（白名单直连无效）。  
2. **multi-id 第二表已修**（SharedWorker + bare onconnect），不再是 93-key 半表状态。  
3. **TLS/UA/sensor 已钉 Chrome 145**；勿拆开只改其中一层。  
4. **Lumi 一次过仍 flaky**，主因出口/边缘联合分，不是「再重试」能修的保真问题。  
5. 后续：出口质量、小并发验收 first-pass、残留 `-2`/canvas 等按需。  

---

*文档随 2026-07-17 会话更新；以 `git log` 为准。*
