# Cebu BMS：确定性有问题的 signals key

**日期**: 2026-07-20  
**范围**: mimic 执行 **已保存 live BMS** 后解密得到的 `signals`（非 Lumi 出口 403）。  
**对照脚本**: `tmp/cebu-baseline/matched/bms.js` + `url.txt`（id 前缀为 **PL**）。  
**更长背景**: `docs/cebu-bms-offline-env-diff.md`、`docs/cebu-bms-401-worklog.md`

---

## 1. 问题 key 清单（确定性）

下列项在 **换 profile、重复 offline replay** 下仍成立，属环境/采集缺口，不是单次 flaky。

### 1.1 失败码（采集失败）

| key | 修复前 | 2026-07-20 后 | 问题 | 根因线索 |
|-----|--------|---------------|------|----------|
| **`PL248`** | `-2` | **`"1"`** | 曾为失败哨兵 | deobf：`HD()`；缺 PushManager / hasPrivateToken / iframe.loading |
| **`PL710`** | `-2` | **`"1"`** | 曾为失败哨兵 | deobf：`MU()`；**非隔离上下文仍暴露 `SharedArrayBuffer`** |

- `PL248`：`chromeFeature` 装 PushManager + hasPrivateToken/hasRedemptionRecord + iframe.loading；Document `order` 键补齐。
- `PL710`：与 HD **不同 vV 批**（`qI,EQ,WP,qM,LU,MU`）。`crossOriginIsolated=false` 时 Chrome 不暴露 SAB；jsdom/host 仍有 → `MU()` → `-2`。修复：`drop window.SharedArrayBuffer`（`securityOps` + `bmsCapabilityOps`）。
- 附带：plugins.refresh 非可写 → `PL588` 中位 `1→0`（`-1;0;-1`）。
- 历史 FK：`FK349`/`FK424` 曾为两枚 `-2`（id 轮换）。

### 1.2 成功但假、全 mimic 固定簇（可聚类 tell）

| key | 稳定值 | 语义 | 问题 |
|-----|--------|------|------|
| **`PL236`** | 曾 `947d9249` | CSS system colors（`pR`：38 色 → `bO(39)`） | **已缓解**：`getComputedStyle` 对 system color 关键字回放 profile 色板；无 `systemColors` 时按 `profile.id` 合成（离开 jsdom 簇） |
| **`PL817`** | `8e726a09c196f96bcf104fd83a6a6278c5ccca1c0b841dd8ecef621b87acf56a` | canvas 2d 指纹（`Lj()`） | 无真机 canvas 回放；**全员同一 hash** |
| **`PL881`** | 曾 `85eefa4e` | OfflineAudio `Vk()` 四元组 → `bO(39)` | **已缓解**：runtime 按 profile.id 合成 reduction/sampleSum/freqSum/timeSum（可 `profile.audio` 覆盖）；零样本簇 `85eefa4e` 已离开 |

**跨 capture 用值找回（id 会换）：**

| 稳定值 | 也曾出现在 |
|--------|------------|
| `947d9249` | `PL236` / `FK445` |
| canvas 64-hex 上表 | `PL817` / `FK401` |
| `85eefa4e` | `PL881` / `FK766` |

### 1.3 明确不算「key 坏了」

| 项 | 说明 |
|----|------|
| multi-id 半表 | offline 已到 ~116 keys，不再是主问题 |
| `PL921` = `coarse,coarse` | 触控成功态 |
| UA / GPU / 时区 / 语言 | **随 profile 变**；属配置选择，不是固定坏 key（默认 Bucharest/en-GB 对 PH 站可能偏，但改 profile 即可） |

### 1.4 一句话

**仍确定有问题的 key：**  
`PL817`（canvas 全员固定 sha256）。  
**已缓解：** `PL248` / `PL710` → `"1"`；`PL881` audio 合成；`PL236` system colors 合成（非全员 `947d9249`）。

---

## 2. 复现方式（必做）

目标：固定 live 脚本 → mimic capture → decrypt → 断言上表 key/值。  
**不需要**改 `cebu_flow`，**不需要**代理/401。

### 2.0 依赖

```text
mimic 仓库（已 npm run build，存在 dist/）
live 脚本：tmp/cebu-baseline/matched/{bms.js,url.txt}
解密：/path/to/akamai/web/bms-decrypt  （与仓库 sibling 或改下面路径）
Node.js、Python3（可选）
```

默认路径（按本机 layout，可改）：

| 变量 | 默认 |
|------|------|
| `MIMIC` | 本仓库根 |
| `LIVE` | `$MIMIC/tmp/cebu-baseline/matched` |
| `DECRYPT` | `$MIMIC/../akamai/web/bms-decrypt` |
| `OUT` | `$MIMIC/tmp/cebu-baseline/offline-replay` |
| `PROFILE` | `android-chrome/2201116sg-v145-10025` |

### 2.1 一步：mimic 跑 live BMS，写出 body

```bash
cd /path/to/mimic
# 若 profile/shapes 刚改过：npm run build

mkdir -p tmp/cebu-baseline/offline-replay
LIVE=tmp/cebu-baseline/matched
OUT=tmp/cebu-baseline/offline-replay
PROFILE=android-chrome/2201116sg-v145-10025

python3 - <<PY
import json
from pathlib import Path

live = Path("tmp/cebu-baseline/matched")
out = Path("tmp/cebu-baseline/offline-replay")
profile = "android-chrome/2201116sg-v145-10025"
payload = {
    "pageUrl": "https://www.cebupacificair.com/en-PH/booking/select-flight",
    "pageHtml": "<!doctype html><html><head></head><body></body></html>",
    "scriptUrl": (live / "url.txt").read_text().strip(),
    "scriptSource": (live / "bms.js").read_text(),
    "cookies": [],
    "profile": profile,
    "deadlineMs": 6000,
    "maxPosts": 2,
    "scriptTimeoutMs": 15000,
    "events": "none",
}
inp = out / "input-repro.json"
inp.write_text(json.dumps(payload))
print(inp)
PY

node test/cebu_capture.mjs tmp/cebu-baseline/offline-replay/input-repro.json \
  > tmp/cebu-baseline/offline-replay/capture-stdout.txt 2> tmp/cebu-baseline/offline-replay/capture-stderr.txt

# 抽出 body
python3 - <<'PY'
import json
from pathlib import Path
raw = Path("tmp/cebu-baseline/offline-replay/capture-stdout.txt").read_bytes()
marker = b"__CEBU_CAPTURE_RESULT__"
if marker not in raw:
    raise SystemExit("no capture result; see capture-stderr.txt")
result = json.loads(raw.split(marker, 1)[1])
assert result.get("ok"), result
bodies = result["bodies"]
assert bodies, "empty bodies"
Path("tmp/cebu-baseline/offline-replay/body-repro.txt").write_text(bodies[0])
probe = result.get("assignProbe") or {}
print("ok bodies", len(bodies), "size", len(bodies[0]),
      "uniqueKeys", probe.get("uniqueKeys"), "batches", probe.get("batchCount"))
PY
```

期望：

- `ok` true，至少 1 个 body  
- SharedWorker 正常时 `uniqueKeys` ≈ **110**，signals 解密后 ≈ **116**

### 2.2 二步：同脚本同 url 解密

```bash
# 按本机 bms-decrypt 位置调整 require 路径
node <<'NODE'
const fs = require('fs');
const path = require('path');
const { decryptBody, normalizeCiphertext } = require(
  path.resolve('../akamai/web/bms-decrypt/lib/decrypt.js')
);

const live = 'tmp/cebu-baseline/matched';
const bodyPath = 'tmp/cebu-baseline/offline-replay/body-repro.txt';
let ciphertext = fs.readFileSync(bodyPath, 'utf8');
try {
  const j = JSON.parse(ciphertext);
  if (j && typeof j.body === 'string') ciphertext = j.body;
} catch (_) {}

const r = decryptBody({
  bmsSource: fs.readFileSync(path.join(live, 'bms.js'), 'utf8'),
  scriptUrl: fs.readFileSync(path.join(live, 'url.txt'), 'utf8').trim(),
  ciphertext: normalizeCiphertext(ciphertext),
});
if (!r.ok) {
  console.error('decrypt failed', r.error || r);
  process.exit(1);
}
const signals = r.parsed?.signals || {};
const out = 'tmp/cebu-baseline/offline-replay/parsed-repro.json';
fs.writeFileSync(out, JSON.stringify({ ok: true, n: Object.keys(signals).length, signals }, null, 2));
console.log('n_signals', Object.keys(signals).length, '->', out);
NODE
```

### 2.3 三步：断言坏 key

```bash
node <<'NODE'
const { signals, n } = JSON.parse(
  require('fs').readFileSync('tmp/cebu-baseline/offline-replay/parsed-repro.json', 'utf8')
);

// 固定假指纹仍钉死；两枚 -2 修后应离开
const expect = {
  PL236: '947d9249',
  PL817: '8e726a09c196f96bcf104fd83a6a6278c5ccca1c0b841dd8ecef621b87acf56a',
  PL881: '85eefa4e',
};

console.log('n_signals', n);
let bad = 0;
for (const k of ['PL248', 'PL710']) {
  const ok = String(signals[k]) !== '-2';
  console.log(ok ? 'OK ' : 'FAIL', k, 'got', signals[k], ok ? '(left -2)' : '(still -2)');
  if (!ok) bad++;
}
for (const [k, want] of Object.entries(expect)) {
  const got = signals[k];
  const ok = String(got) === want;
  console.log(ok ? 'OK ' : 'FAIL', k, 'want', want, 'got', got);
  if (!ok) bad++;
}

// 值存在性（id 若轮换仍可搜）
for (const v of ['947d9249', '85eefa4e', '-2']) {
  const hits = Object.entries(signals).filter(([, x]) => String(x) === v);
  console.log('value', v, '->', hits.map(([k]) => k).join(',') || '(none)');
}
const canvas = Object.entries(signals).filter(
  ([, x]) => typeof x === 'string' && x.startsWith('8e726a09c196f96b')
);
console.log('canvas-like', canvas.map(([k]) => k).join(',') || '(none)');

process.exit(bad ? 1 : 0);
NODE
```

**通过标准（2026-07-20 后）：**

| 检查 | 期望 |
|------|------|
| `PL248` / `PL710` | **不是** `'-2'`（现均为 `"1"`） |
| `PL236` | `947d9249` |
| `PL817` | 上表 64-hex |
| `PL881` | `85eefa4e` |
| `n_signals` | ~116（第二表开时） |
| 任意 `-2` | **无** |

修复 canvas / system colors 后，对应固定 hash 断言应**故意改掉**。

### 2.4 可选：证明「换 profile 改不了固定簇」

对第二个 profile 重复 §2.1–2.3（例如 `android-chrome/2107113sg-v139-56937`）：

| 字段 | 期望 |
|------|------|
| `PL236` / `PL817` / `PL881` / 两个 `-2` | **与 v145 相同** |
| `PL586`（UA）/ GPU 相关 | **可不同** |

---

## 3. 用历史 body 快速核对（不重跑 mimic）

若仅验证「文档里的值是否仍写在旧 decrypt 里」：

```bash
# 原 Jul-17 body（93 keys，multi-id 前）
node -e '
const { decryptBody, normalizeCiphertext } = require("../akamai/web/bms-decrypt/lib/decrypt.js");
const fs = require("fs");
const r = decryptBody({
  bmsSource: fs.readFileSync("tmp/cebu-baseline/matched/bms.js","utf8"),
  scriptUrl: fs.readFileSync("tmp/cebu-baseline/matched/url.txt","utf8").trim(),
  ciphertext: normalizeCiphertext(fs.readFileSync("tmp/cebu-baseline/matched/body_raw.txt","utf8")),
});
const s = r.parsed.signals;
for (const k of ["PL248","PL710","PL236","PL817","PL881"])
  console.log(k, s[k]);
console.log("n", Object.keys(s).length);
'
```

期望：两个 `-2` + 三固定 hash 与 §1 一致；`n` 可能为 93（旧 body）。

---

## 4. 约束与坑

1. **必须** `bms.js` 与 `url.txt` 同源（同一 `v=`）；混用会 decrypt 失败或字段错位。  
2. live 脚本更新后 **PL 数字可能全换**；以 §1.2 稳定值为准搜 key。  
3. 本复现**不**测 availability 401 / 出口；只证明 sensor 环境问题。  
4. `tmp/` 默认不入库；缺 `matched/bms.js` 时需自行从 live 再抓一份进 `tmp/cebu-baseline/matched/`。  
5. `bms-decrypt` 路径按本机调整（上文默认 `../akamai/web/bms-decrypt`）。

---

## 5. 修复后如何回归

| 修复项 | 回归期望 |
|--------|----------|
| system colors 查表 | `PL236`（或同值位）**不再**为 `947d9249`；宜对齐真机 hash |
| canvas replay | `PL817` **不再**为上表 64-hex |
| `HD`（PL248） | **已做**：PushManager + hasPrivateToken + iframe.loading |
| plugins.refresh 非可写 | **已做**：`PL588` 中位 `1→0`；`item` ToUint32 |
| `MU`（PL710） | **已做**：非隔离时 `drop SharedArrayBuffer` |
| system colors / canvas | 固定假指纹仍在 |
| 仅改 profile | 固定簇三 hash 仍不变 |

---

## 6. 相关路径

| 用途 | 路径 |
|------|------|
| 本清单 | `docs/cebu-bms-bad-keys.md` |
| 离线方法长文 | `docs/cebu-bms-offline-env-diff.md` |
| e2e worklog | `docs/cebu-bms-401-worklog.md` |
| capture bridge | `test/cebu_capture.mjs` |
| live 脚本 | `tmp/cebu-baseline/matched/bms.js` |
| deobf | `tmp/cebu-baseline/matched/deobf/bms.deobfuscated.js`（`pR` / `Lj` / `bO` case 39） |

---

*以 2026-07-20 offline replay 为准；问题 key 仍在时 §2.3 断言应全部 OK。*
