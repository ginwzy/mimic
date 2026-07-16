# Cebu Pacific BMS / mimic 工作纪要

**日期**: 2026-07-16 → 2026-07-17  
**仓库**: `mimic`  
**目标站点**: `www.cebupacificair.com` + `soar.cebupacificair.com` availability  
**主入口**: `test/cebu_flow.py` + `test/cebu_capture.mjs`  
**成功判据**: availability **HTTP 401**（边缘 bot 通过 + 匿名 Access Token 过期）  
**结果**: **已达成**（本地无代理、无硬塞 cookie，连续复验通过）

相关 commits（main，由旧到新）:

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

Beads:

- `js-sandbox-env-framework-ajt` — **已关**（401 达成）
- `js-sandbox-env-framework-yk7` — **仍 open**：live BMS `Ey###` multi-id 第二表约 93 keys（保真债，非 401 阻断）

过程产物（本地、默认不入库）: `tmp/cebu-bms-diff/`（HANDOFF、MULTI_ID、解密 CLI、真机/mimic plain 等）。

---

## 1. 问题与成功定义

### 1.1 业务流程

```
GET select-flight
  → 拉取 BMS 脚本 + abck 脚本
  → mimic 执行 BMS → POST sensor → 巩固 bm_*（尤其 bm_s）
  → mimic 执行 abck → 多 POST → _abck 至 ~0~
  → POST soar availability（只带 _abck + bm_s）
```

### 1.2 现象（修复前）

- abck 往往已 **201** 且 `_abck` 含 **`~0~`**
- availability 仍 **HTTP 403** Access Denied  
- 判据约定：**401** = bot 过、应用层 token 无效/过期；**403** = 边缘直接拒（bot / TLS / cookie 质量等）

### 1.3 初判与方法

初判更偏 **BMS / `bm_s` 质量**，而非 abck 表面握手失败。

方法：真机 HAR 与 mimic 同脚本对照解密 → 键集合 / multi-id 成组 / 插桩 API（区分「环境没有」vs「脚本没调」vs「调用失败」）。

---

## 2. 做了哪些工作

按主题归纳（含跨多 commit 的环境与流程改动）。

### 2.1 密码学与脚本绑定

| 项 | 问题 | 修复 |
|----|------|------|
| `document.currentScript` | 跑 BMS 时无 `v=` → `urlKey=0`，密文与真机不可比 | `runtime.run({url})` 临时挂 script + currentScript |
| 解密工具 | Cebu xb 字母表含 `$`、锚点/sibling 窗口不匹配 | 临时 CLI：`tmp/cebu-bms-diff/decrypt_body_cebu.cjs`（未正式合入 forge） |

### 2.2 GPU / Worker / iframe（BMS 探测面）

| 项 | 问题 | 修复 |
|----|------|------|
| OffscreenCanvas | BMS 用 `new OffscreenCanvas(0,0).getContext('webgl')`，jsdom 无此 API → GPU 分支整段跳过 | 构造 + 委托 HTML canvas / webgl 驱动 |
| Worker | 能力缺失（且部分 shape 门控错误） | 暴露 ctor；blob/data 同进程 `with(self)` 真跑 |
| `URL.createObjectURL` | Worker(blob) 路径缺 | 补 create/revoke |
| Detached iframe | BMS 建未挂载 about:blank；jsdom `contentWindow.document` 常无 | contentWindow 首次访问时隐藏 auto-parent；`port.evaluate` / `port.make`；跨 realm OffscreenCanvas |
| ANGLE 字符串 | profile 裸 `Adreno`，真机 `ANGLE (Qualcomm, …)` | profile unmaskedRenderer 改为 ANGLE 形态 |

**实测插桩结论（本版 Cebu BMS）**:

- **不** `new Worker`（Worker 真执行对当前 24-key 缺口无直接收益）
- **会** 主线程 `OffscreenCanvas` + webgl/webgl2
- **会** `createElement('iframe')` 且不 append；修好后 iframe 内 GL 可用，但 **第二 multi-id 表仍不写**（见 §4）

### 2.3 指纹 / 能力面（非「换 UA 版本」类环境对齐）

| 项 | 问题 | 修复 |
|----|------|------|
| matchMedia | 误用 jsdom 主机实现（桌面 fine/hover）；且 `maxTouchPoints` 在 captureSources 时被冻成 0 | 始终 emulated MediaQueryList；**live** 读 `navigator.maxTouchPoints` / 几何 |
| `connection.type` | NetworkInformation 无 type → `["4g",-1,"null"]` | 暴露 type；mobile 默认 `wifi` |
| `isSecureContext` / `crossOriginIsolated` | jsdom 缺失 | window 上补 true / false |
| RTCPeerConnection | shape 误门控为 chrome≥149 或 webview | 所有 chrome/webview 暴露 |
| `canPlayType` | jsdom 恒空串 → 媒体向量全 0 | Chrome Android 常见 codec → `probably`/`maybe` |
| `performance.memory` | 无 MemoryInfo → heap 传感器为 -1 | 补 memory + 典型 heap 数值 |
| Notification / speechSynthesis | typeof 探测失败 | 最小 stub |
| serviceWorker / permissions / caches | 空 accessor 返回 undefined | ServiceWorkerContainer / Permissions / CacheStorage 最小实现 |
| document.fonts | undefined | FontFaceSet stub |
| TextMetrics | width 以外全 0 | 按 font-size 估 ascent/descent 等 |
| Android plugins | 注入桌面 5 个 PDF 插件 | **mobile form 空 PluginArray**（真机 Chrome Android 常见） |

### 2.4 页面生命周期（401 关键之一）

**根因**: capture 原先在 **job 脚本跑完之后** 才跑 `lifecycle=auto`。

结果：BMS/abck 执行时：

- `document.readyState === 'loading'`
- `document.hasFocus() === false`

真机 load 完成后通常是 `complete` + focused。

**修复**（`src/app/index.ts`）:

1. **先** 跑 lifecycle：强制 `readyState=complete`、`Document.prototype.hasFocus → true`，并派发 DOMContentLoaded/load  
2. **再** 跑 page script（BMS/abck）  
3. 再 poll 收 POST body  

这是从 403 翻到 401 的**关键顺序修复**。

### 2.5 `cebu_flow` 编排

| 配置 | 说明 |
|------|------|
| 无代理 | `make_client()` 默认不设 proxies（本地网络） |
| 无硬塞 bm_s | search 只用 jar 里真实 BMS Set-Cookie |
| 顺序 | **abck 多 POST 先，BMS 后**（对齐真机 HAR 时间线） |
| abck 策略 | 默认 POST **全部** capture 到的 body |
| BMS deadline | 提到 4s（1s 易空 capture） |

---

## 3. 关键点（按影响力）

### 3.1 必须先有的「脚本能正确加密」

1. **currentScript → urlKey**  
   没有 `v=` 时密文路径与真机完全不同，后续字段 diff 失真。

2. **OffscreenCanvas WebGL**  
   本版 BMS GPU 指纹主路径；缺失则 unmasked vendor/renderer 整段为 null。

### 3.2 从 403 → 401 的「边缘信任」组合

下列组合显著抬高 `bm_s` / 边缘信任（在 abck 已 `~0~` 前提下）：

1. **lifecycle 在脚本前**（readyState + hasFocus）— **最高杠杆**  
2. **Android 空 plugins** — 强 desktop tell  
3. **matchMedia 真 coarse + connection.type + canPlayType + memory** 等能力向量  
4. **secure-context 相关 stub**（SW / permissions / caches / isSecureContext）  
5. **abck 全量 + BMS 足够 deadline + 无硬塞 cookie**

### 3.3 方法论关键点

1. **同脚本、同 `v=` 解密对照** — 键集合比盲调 UA 更有效。  
2. **插桩 Object.assign / API** — 证明 multi-id 第二表是「从未写入」而非解密丢键。  
3. **Live 脚本前缀是 `Ey###`，HAR 是 `iV###`** — 禁止把 HAR 的 id 映射硬塞进 live body（会注入脏键）。  
4. **profile 改完必须 `npm run build`（+ 常要 generate shapes）** — `createMimic` 默认读 `dist/assets/profiles`。

### 3.4 已证伪 / 低收益路径

| 路径 | 结论 |
|------|------|
| Worker 真执行加深 | 本版 Cebu BMS 不 `new Worker` |
| 仅修 iframe GL | 修好后仍 92 keys；BMS 几乎不用 iframe 内 OffscreenCanvas |
| 仅 getHE 两次 | 两次成功仍缺第二组 brands/UA id |
| HAR iV 对拷补键 | live 为 Ey###，映射错误且有害 |
| 固定真机 bm_s | 掩盖问题；验证时必须关掉 |

---

## 4. 剩余工作

### 4.1 P0 保真：live multi-id 第二表（`yk7`）

- Live BMS 明文约 **93** 个 `Ey###` 键；真机 HAR 同代脚本约 **116** 个 `iV###`。  
- 模式不变：同一事实写 2/4 个 id，mimic 只写一半（ANGLE 2/4、UA 1/2 等）。  
- 写入形态：几乎全经 **`Object.assign`**；第二表对应 batch **从不出现**。  
- **iframe 双 realm / getHE 二次 都不是充分条件**。  
- 建议：对 **当前 live `bms.js`** 反混淆/运行时解 string table，定位 id map 成对写入与门控（勿套旧 HAR iV 表）。

### 4.2 P1 仍差的传感器值（非换 Chrome 大版本也能改）

| 信号形态 | 问题 |
|----------|------|
| `Ey110` / `Ey966` = `-2` | 失败码类，真机多为成功态 `1` |
| `Ey340` 等 = `NaN` | 数值计算失败 |
| 多枚 `false` 能力位 | 与真机 `true` 组不完全对齐 |
| `Ey888` 第三位 | 真机常有 true 分量 |
| canvas 长指纹 / cookie 哈希类 | 仍可能偏短或 `'n'` |

### 4.3 P1 环境对齐（有意后置）

用户要求优先修 **非「环境画像」** 不一致。仍可提升一致性：

- Chrome 主版本 / GREASE brands 顺序  
- 时区 / languages（真机 Asia/Shanghai + zh-CN）  
- GPU 型号（Adreno 650 vs 619）  
- page href（`/en-PH/` vs select-flight 路径）  
- `platform`：`Linux armv81` vs `armv8l`  

### 4.4 P2 工程债

- 将 Cebu xb 解密适配正式合入 `forge/vendor/bms/decrypt_body.js`  
- `isSecureContext` 按 `location.protocol` 门控（http 目标勿过度暴露）  
- abck `error.stack` / `prepareStackTrace` own tell（既有 beads）  
- 可选：availability 使用新鲜 token（当前 401 body 为 Invalid Access Token，符合「bot 过」判据）

### 4.5 P3 端到端加固

- 多地域 / 多并发稳定性回归  
- TLS/JA3 与 rnet Emulation 是否与 Android UA 一致  
- 交叉实验：真机 `bm_s` + mimic `_abck` 隔离边缘因子（仅诊断）

---

## 5. 如何复现与对照

### 5.1 端到端（成功路径）

```bash
cd /Users/zion/projects/work/web_reverse/mimic
npm run build   # profile/shapes 变更后必须
python3 test/cebu_flow.py --search
# 期望: availability HTTP 401 success=True, exit 0
```

要求：

- 默认 **无 proxy**  
- **不要** 打开硬塞 `bm_s` 的代码路径  

### 5.2 BMS 明文对照（HAR 脚本）

```bash
node tmp/cebu-bms-diff/decrypt_body_cebu.cjs \
  --bms tmp/cebu-bms-diff/real/bms.js \
  --url "$(tr -d '\n' < tmp/cebu-bms-diff/real/bms_script_url.txt)" \
  --body-file <inner_ciphertext.txt>
```

Wire：`{"body":"<ciphertext>"}`，解密用 **inner**。

### 5.3 关键代码触点

| 区域 | 路径 |
|------|------|
| capture lifecycle 顺序 | `src/app/index.ts` |
| currentScript | `src/engines/jsdom.ts` |
| iframe dual-realm | `src/engines/jsdom.ts` `bootChildRealms` |
| Worker / OffscreenCanvas / canPlayType | `src/features/dom.ts` |
| matchMedia | `src/features/globals.ts` |
| connection / SW / permissions / caches / fonts | `src/features/nav.ts` |
| performance.memory | `src/features/perf.ts` |
| TextMetrics | `src/features/canvas.ts` |
| Android 空 plugins | `src/features/plugins.ts` |
| Cebu 流程 | `test/cebu_flow.py`, `test/cebu_capture.mjs` |
| Profile | `profiles/android-chrome/2201116sg-v138-10025.json` |

### 5.4 过程文档（tmp，可选阅读）

- `tmp/cebu-bms-diff/HANDOFF.md` — 早期交接  
- `tmp/cebu-bms-diff/MULTI_ID.md` — multi-id 24 keys 专项  
- `tmp/cebu-bms-diff/ANGLE.md` — ANGLE 形态  
- `tmp/cebu-bms-diff/INVESTIGATION.md` / `DIFF.md` — 过程记录  

---

## 6. 结论

1. **Cebu 端到端 bot 过关（401）已在本地无代理路径上稳定复现。**  
2. 关键不是「再堆一个 Worker」，而是：  
   - 正确加密上下文（currentScript）  
   - GPU 主路径（OffscreenCanvas）  
   - **页面在脚本前进入 complete + focused**  
   - Android 能力面不像桌面（plugins / media / matchMedia / secure APIs）  
3. **multi-id 第二表仍是明确保真债**（live ~93 keys），单独跟踪 `yk7`，不阻塞当前 401 判据。  
4. 后续优先：live 脚本 id map 门控 + 残留 `-2`/`NaN`/false 位；环境画像对齐按需做。

---

*本文档描述 2026-07-16/17 会话内已合入 main 的工作；以 git history 为准。*
