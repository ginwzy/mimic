# Cebu BMS：离线 live 脚本 + mimic 环境字段对照

**日期**: 2026-07-20  
**目的**: 不改 `cebu_flow`、不依赖 live e2e，用**已保存的 live BMS** 跑 mimic，解密 `signals`，区分「随环境变」与「全 mimic 固定簇」。  
**成功用途**: 查 system colors / canvas / `-2` / profile 是否进 sensor，而不是冲 availability 401。

---

## 1. 结论摘要

1. **mimic 可以直接跑以前的 live 脚本**（`scriptSource` + `scriptUrl`），不必改 `cebu_flow`。
2. 同脚本、同 `v=` 下换 profile：**UA / GPU / 时区 / 语言会变** → profile 已进 BMS 表。
3. 下列字段在多次 offline replay 中**完全不变**（环境外固定簇 / 失败码）：
   - system colors hash `947d9249`（`PL236`，此脚本 id）
   - canvas sha256 `8e726a09…cf56a`（`PL817`）
   - 另一 u32 hash `85eefa4e`（`PL881`）
   - 残留 `-2`：`PL248`、`PL710`（恰 2 个）
4. system colors **已采集成功**（非 `-2`），色板来自 **jsdom 默认**，mimic **无专用 system-color 处理**。
5. live id 前缀/数字会轮换；跨 capture **按稳定值对齐**，不要 `PL236` 硬对 `FK236`。

---

## 2. 方法（分析向流水线）

```text
saved bms.js + url.txt
  → node test/cebu_capture.mjs   # createMimic.capture；只换 profile
  → sensor body
  → bms-decrypt(同 bms.js + url)
  → signals (PL### / FK### …)
```

| 层 | 是否需要 live 出口 |
|----|-------------------|
| 跑脚本、出 body、decrypt | **否** |
| POST Akamai / soar 401 | 是（本文件不覆盖） |

`cebu_capture.mjs` 入参即源码字符串，引擎**不会**自己拉脚本。  
`cebu_flow.py` 默认每次 HTTP 拉 live；环境 dig 用 offline 即可。

### 2.1 最小复现

```bash
cd /path/to/mimic
# 输入：tmp/cebu-baseline/matched/{bms.js,url.txt}
# 见 §5 产物目录；或：

node <<'NODE'
const fs = require('fs');
const input = {
  pageUrl: 'https://www.cebupacificair.com/en-PH/booking/select-flight',
  pageHtml: '<!doctype html><html><head></head><body></body></html>',
  scriptUrl: fs.readFileSync('tmp/cebu-baseline/matched/url.txt', 'utf8').trim(),
  scriptSource: fs.readFileSync('tmp/cebu-baseline/matched/bms.js', 'utf8'),
  cookies: [],
  profile: 'android-chrome/2201116sg-v145-10025',
  deadlineMs: 6000,
  maxPosts: 2,
  scriptTimeoutMs: 15000,
  events: 'none',
};
fs.writeFileSync('/tmp/cebu-offline-in.json', JSON.stringify(input));
NODE
node test/cebu_capture.mjs /tmp/cebu-offline-in.json
# stdout: __CEBU_CAPTURE_RESULT__{ ok, bodies, assignProbe }

# 解密（需 akamai/web/bms-decrypt）
node -e '
const { decryptBody, normalizeCiphertext } = require("../akamai/web/bms-decrypt/lib/decrypt.js");
const fs = require("fs");
const r = decryptBody({
  bmsSource: fs.readFileSync("tmp/cebu-baseline/matched/bms.js","utf8"),
  scriptUrl: fs.readFileSync("tmp/cebu-baseline/matched/url.txt","utf8").trim(),
  ciphertext: normalizeCiphertext(fs.readFileSync("BODY.txt","utf8")),
});
console.log(r.ok, Object.keys(r.parsed?.signals||{}).length);
'
```

**约束**：`scriptUrl` 的 `v=` 必须与 `bms.js` 同源；跨 version 混用会解不开或字段错位。

---

## 3. 数据源

### 3.1 Live 脚本（固定）

| 文件 | 说明 |
|------|------|
| `tmp/cebu-baseline/matched/bms.js` | 2026-07-17 live BMS |
| `tmp/cebu-baseline/matched/url.txt` | 对应 script URL（含 path/`v`） |
| `tmp/cebu-baseline/matched/body_raw.txt` | 当时 mimic 的 body（对照用） |

### 3.2 历史 decrypt（Jul-17 会话）

| 标签 | 路径 | keys | 备注 |
|------|------|------|------|
| pre_multi | `matched/decrypt/parsed.json` | 93 | SharedWorker 前；PL |
| after_sw | `matched-after-sw/parsed.json` | 93 | SW 半路径；FK |
| after_onconnect | `matched-after-onconnect/parsed.json` | 116 | bare onconnect；FK |

### 3.3 2026-07-20 离线 replay

| 标签 | profile | keys | 产物 |
|------|---------|------|------|
| replay_v145 | `android-chrome/2201116sg-v145-10025` | **116** | `offline-replay/body-2201116sg-v145-10025.txt` |
| replay_v139 | `android-chrome/2107113sg-v139-56937` | **116** | `offline-replay/body-2107113sg-v139-56937.txt` |
| summary | — | — | `offline-replay/summary.json` |
| parsed | — | — | `offline-replay/parsed-*.json` |

assignProbe：两 profile 均为 **uniqueKeys=110**、batches=9。

---

## 4. 字段对照（值对齐）

### 4.1 固定簇 / 失败（换 profile、换日期仍同）

| 语义 | 本 live 脚本 key | 稳定值 | 说明 |
|------|------------------|--------|------|
| **system colors** | `PL236` | `947d9249` | `pR`：38 CSS system color → `JSON.stringify` → `bO(39)` seed **5381** |
| **canvas 2d** | `PL817` | `8e726a09c196f96bcf104fd83a6a6278c5ccca1c0b841dd8ecef621b87acf56a` | `Lj()` fillText/arc；无真机 canvas 回放 |
| **u32 簇** | `PL881` | `85eefa4e` | 疑 nav 键序 / 其它 `bO(39)`；全 mimic 固定 |
| **fail（已修）** | `PL248` / `PL710` | 曾 `-2` → **`"1"`** | HD：PushManager/hasPrivateToken/loading；MU：非隔离时去掉 SharedArrayBuffer |

历史 FK 时代同值对齐示例：

| 值 | pre (PL) | after (FK) |
|----|----------|------------|
| `947d9249` | `PL236` | `FK445` |
| canvas sha256 | `PL817` | `FK401` |
| `85eefa4e` | `PL881` | `FK766` |
| `-2`×2 | `PL248`/`PL710` | `FK349`/`FK424`（数字已轮换，勿硬映射） |

#### System colors 细节

```text
div + background-color: <SystemColor> !important
→ getComputedStyle(div).backgroundColor
→ map → JSON.stringify → hash
```

- mimic：**跑通、非 `-2`/非 `e`**
- 色板：**jsdom 默认**（如 ActiveBorder `rgb(51,51,51)`）
- 同算法 + 桌面 Chrome 色板样本 → hash `ace647af`（与 jsdom 不同）
- **无** `ActiveBorder` / system-color 查表 patch；profile 随机也改不了 `PL236`

### 4.2 随 profile 变（环境已进表）

`replay_v145` vs `replay_v139`（同 live 脚本，**32** 个同 key 值不同），代表：

| 域 | v145 例 | v139 例 | keys 例 |
|----|---------|---------|----------|
| UA major | Chrome/145 | Chrome/139 | `PL586`, `PL874` |
| brands / fullVersion | 145.x | 139.x | `PL229`, `PL666`, `PL521` |
| GPU | Adreno **619** ANGLE 全串 | Adreno **660** | `PL097`, `PL354`, `PL647`… |
| 时区 | Europe/Bucharest | Europe/Warsaw | `PL450`, `PL458`, Date 串 |
| languages | en-GB,en-US,en,pl | pl-PL | `PL004`, `PL006`, `PL840` |
| platformVersion | 13.0.0 | 14.0.0 | `PL128`, `PL343` |
| deviceMemory 等 | 4 | 8 | `PL440`, `PL501` |

→ 用 offline live 脚本 dig 环境 **有效**。

### 4.3 其它成功态（环境相关，非失败）

| 语义 | 例 | 备注 |
|------|-----|------|
| matchMedia | `PL921` = `coarse,coarse` | 触控；成功态 |
| connection | `["4g",-1,"wifi"]` | 多字段重复 |
| 时区串 | Date `GMT+0300` + `Europe/Bucharest` | 与 PH 航司/出口可再对齐 |

### 4.4 multi-id

| 状态 | keys |
|------|------|
| SharedWorker 前 / 半路径 | ~93 |
| onconnect 后 / 2026-07-20 offline | **~116** |

第二表含 UA 双写、HE brands、GPU 第二批等。当前残留重点不再是「半表」，而是 **2×`-2` + 三固定 hash 簇**。

---

## 5. 产物路径

```text
tmp/cebu-baseline/
  matched/                 # live 脚本 + 原 body + 历史 decrypt/deobf
  matched-after-onconnect/
  matched-after-sw/
  offline-replay/          # 2026-07-20 offline
    summary.json
    body-2201116sg-v145-10025.txt
    body-2107113sg-v139-56937.txt
    parsed-baseline_orig_body.json
    parsed-replay_v145.json
    parsed-replay_v139_other.json
    assign-*.json
  field-diff-value-aligned.md   # 自动生成的值对齐表（可参考）
```

本文件为权威说明；`tmp/` 默认不入库，复现时按 §2 重跑即可。

---

## 6. 对成功率 / 修复优先级（字段视角）

| 优先级 | 项 | 类型 |
|--------|-----|------|
| P0 业务 | Lumi 出口信誉 | 非 payload（worklog） |
| P1 payload | `PL248`/`PL710` = `-2`（解 vV `HD`/`MU`） | 失败码 |
| P1 payload | system colors / canvas / `85eefa4e` 固定簇 | 成功但假、可聚类 |
| P2 | 时区、语言与目标站对齐 | profile |
| 已解决 | multi-id 第二表、coarse | — |

字段修复是**降噪**；tilde0+bm_s 仍真时的 403 仍以出口为主。

---

## 7. 未做

- 真机同 `v=` body 并排 decrypt（仅有 mimic 侧）
- vV 字节码还原 `HD`/`MU` 具体 API
- system-color / canvas 回放实现（仅记录缺口）

---

## 8. 相关

- **确定性坏 key + 复现步骤**：`docs/cebu-bms-bad-keys.md`
- 端到端工作纪要：`docs/cebu-bms-401-worklog.md`
- flow：`test/cebu_flow.py`（live e2e）
- bridge：`test/cebu_capture.mjs`
- deobf 参考：`tmp/cebu-baseline/matched/deobf/bms.deobfuscated.js`（`pR` system colors，`Lj` canvas，`bO` case 39）

---

*2026-07-20 offline replay 实测写入；id 以当次 live 脚本为准，跨 capture 用值对齐。*
