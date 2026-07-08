/**
 * fp_env(Akamai sensor 采集)→ mimic profile 身份池导入器。
 *
 * 定位:这批 z__env 是「真机环境身份池」(运行时挑一条来伪装),不是一次性种子。本脚本把每条
 * **不同身份**清洗成 mimic 原生 profile,落 profiles/android-chrome/ 子目录、入库;之后运行时只认仓内
 * profiles/,fp_env 原始目录不再参与运行(故路径是导入时的命令行参数,非运行时依赖)。
 *
 * 身份去重按**完整指纹**(只剔真重复)—— 同机型的不同 locale/时区/屏幕/补丁版本都是独立身份,
 * 正是池价值所在;按机型去重会丢这层多样性,故不做。
 *
 * 数据底层完全对得上(已实测):
 *  - collect1.getParameter_info[0] 与 mimic webgl.parameters 同为 GL enum 数字键
 *    (37445/37446=UNMASKED vendor/renderer,patch/webgl.js 直接消费)。
 *  - userAgentData.HighEntropyValues 拍平即 collect.js 的 userAgentData 形。
 *  - Date.TimezoneOffset 为真机采集 offset;Intl.Timezone 为 IANA 名。
 *
 * 入库范围 = mimic 当前能回放的标量身份段(navigator+UA-CH / screen / window / timezone / webgl 参数表)。
 * 渲染类(canvas/fonts 图像、webgl 图)当前 mimic 不回放(canvas/audio patch 为 stub),不入库;需要时
 * 另起语料目录保留 collect1 真值。各兜底:
 *  - window.chrome 存在性:fp_env 未采 → 不写该键,host=chrome 走 UA 兜底校验,patch/chrome 合成。
 *  - navigator.vendor/cookieEnabled:移动 Chrome 固定值,补默认。
 *
 * 用法(语料目录为必填的绝对路径参数):
 *   node tools/fp-env/adapt.mjs /abs/path/to/fp_env            # 全量不同身份 → profiles/android-chrome/
 *   node tools/fp-env/adapt.mjs /abs/path/to/fp_env --limit 50 # 只导前 50 条(冒烟用)
 *   node tools/fp-env/adapt.mjs /abs/path/to/fp_env --dry      # 只跑映射+validate,不落盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profile } from '../../core/profile.js';
import { deriveTraits } from '../../capture/derive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const FP_ENV_DIR = argv.find((a) => a.startsWith('/')); // 语料目录:导入时显式给,不写死、不走 env
const OUT_DIR = path.resolve(__dirname, '../../profiles/android-chrome');
const DRY = argv.includes('--dry');
const LIMIT = (() => { const i = argv.indexOf('--limit'); return i >= 0 ? Number(argv[i + 1]) : Infinity; })();

if (!FP_ENV_DIR) {
  console.error('用法:node tools/fp-env/adapt.mjs /abs/path/to/fp_env [--limit N] [--dry]\n需把 fp_env 采集目录作为绝对路径参数传入。');
  process.exit(1);
}

const DEFAULT_VENDOR = 'Google Inc.';
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** 从 IANA 时区名算 getTimezoneOffset 风格分钟数(west 为正),作 Date.TimezoneOffset 缺时兜底。 */
function tzOffsetMinutes(timeZone, ms) {
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms));
    const o = {};
    for (const x of p) o[x.type] = x.value;
    const asUTC = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
    return -(asUTC - ms) / 60000;
  } catch { return undefined; }
}

/** fp_env 单文件 → mimic profile(自包含,镜像 profiles/android-webview-v138.json 形)。 */
function fpToProfile(d, captureFile, id) {
  const n = d.navigator || {};
  const hev = (n.userAgentData && n.userAgentData.HighEntropyValues) || {};
  const ua = n.userAgent || '';
  const major = Number((ua.match(/Chrom(?:e|ium)\/(\d+)/) || [])[1]);
  const model = hev.model || '';

  // userAgentData:HighEntropyValues 拍平为 collect.js 形(brands/mobile/platform 在外,高熵并列)。
  const userAgentData = {
    brands: hev.brands,
    mobile: hev.mobile,
    platform: hev.platform,
    architecture: hev.architecture,
    bitness: hev.bitness,
    model: hev.model,
    platformVersion: hev.platformVersion,
    uaFullVersion: hev.uaFullVersion,
    fullVersionList: hev.fullVersionList,
    wow64: hev.wow64,
  };

  const navigator = {
    userAgent: ua,
    appVersion: n.appVersion,
    platform: n.platform,
    vendor: n.vendor || DEFAULT_VENDOR,
    language: n.language,
    languages: Array.isArray(n.languages) ? n.languages : (n.language ? [n.language] : []),
    hardwareConcurrency: n.hardwareConcurrency,
    deviceMemory: n.deviceMemory,
    maxTouchPoints: n.maxTouchPoints,
    cookieEnabled: n.cookieEnabled !== undefined ? n.cookieEnabled : true,
    userAgentData,
  };
  if (n.connection) {
    navigator.connection = {
      effectiveType: n.connection.effectiveType,
      downlink: n.connection.downlink,
      rtt: n.connection.rtt,
      saveData: n.connection.saveData,
    };
  }

  const s = d.screen || {};
  const screen = {
    width: s.width, height: s.height, availWidth: s.availWidth, availHeight: s.availHeight,
    colorDepth: s.colorDepth, pixelDepth: s.pixelDepth,
    orientation: s.orientation ? { type: s.orientation.type, angle: s.orientation.angle } : undefined,
  };

  // window.chrome 故意不写 —— fp_env 未采;host=chrome 由 validate 的 UA 兜底放行,patch/chrome 合成。
  const window = {
    innerWidth: d.innerWidth, innerHeight: d.innerHeight,
    outerWidth: d.outerWidth, outerHeight: d.outerHeight,
    devicePixelRatio: d.devicePixelRatio,
  };

  const timeZone = d['Intl.Timezone'];
  const offset = (d.Date && typeof d.Date.TimezoneOffset === 'number')
    ? d.Date.TimezoneOffset
    : tzOffsetMinutes(timeZone, Date.UTC(2025, 6, 1));
  const timezone = { timeZone, offset };

  // webgl:getParameter_info[0] 即 enum 数字键表(同 mimic webgl.parameters);[1] 是 shader 精度,不并入。
  let webgl;
  const gp = d.collect1 && Array.isArray(d.collect1.getParameter_info) ? d.collect1.getParameter_info[0] : null;
  if (gp) {
    webgl = {
      parameters: { ...gp },
      extensions: (d.collect1 && d.collect1.canvas_webgl2_SupportedExtensions) || [],
      unmaskedVendor: gp['37445'],
      unmaskedRenderer: gp['37446'],
    };
  }

  // 命名:<机型>-v<主版本>-<z__env id>。同机型多身份靠 id 区分并可溯源回采集文件。带子目录前缀作 load 键。
  const base = [model ? slug(model) : `gpu-${slug(webgl?.unmaskedRenderer || 'unknown')}`, `v${major}`, id].join('-');
  const name = `android-chrome/${base}`;
  const meta = {
    source: 'fp_env-akamai',
    captureFile, // 配对真机采集文件名 —— 供 tools/fp-env/verify.mjs 取 ground truth
    hygiene: { devicePixelRatio: d.devicePixelRatio, issues: [] },
    fidelity: {
      navigator: 'real', screen: 'real', window: 'real', timezone: 'real',
      webgl: webgl ? 'params' : 'absent',
      canvas: 'absent', audio: 'absent', fonts: 'absent',
    },
    // traits 用项目自有派生(单一真相源):platform/formFactor/host/version 从 UA + window 推,
    // 不硬编码 —— 否则平板(UA 无 Mobile)被误标 mobile 而 validate 失败。host 经 detectHost:
    // window 无 chrome 键 + 有 userAgentData → chrome。
    traits: deriveTraits({ navigator, window }),
    name,
  };

  const profile = { meta, navigator, screen, window, timezone };
  if (webgl) profile.webgl = webgl;
  return { profile, base };
}

/** 身份段序列化(去 meta)—— 完整指纹去重键:同身份不同采集文件 → 一条。 */
const identityKey = (p) => JSON.stringify({ navigator: p.navigator, screen: p.screen, window: p.window, timezone: p.timezone, webgl: p.webgl });

async function main() {
  const files = fs.readdirSync(FP_ENV_DIR).filter((f) => /^z__env_.*\.json$/.test(f));
  if (!files.length) { console.error(`无 z__env_*.json:${FP_ENV_DIR}`); process.exit(1); }

  // 按完整指纹去重,首见留存。
  const distinct = new Map(); // identityKey → {profile, base}
  let dupes = 0;
  for (const f of files) {
    const id = (f.match(/^z__env_(.+)\.json$/) || [])[1];
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(FP_ENV_DIR, f), 'utf-8')); } catch { continue; }
    const { profile, base } = fpToProfile(d, f, id);
    const k = identityKey(profile);
    if (distinct.has(k)) { dupes++; continue; }
    distinct.set(k, { profile, base });
  }

  let reps = [...distinct.values()];
  if (Number.isFinite(LIMIT)) reps = reps.slice(0, LIMIT);

  console.log(`扫描 ${files.length} 文件 → ${distinct.size} 个不同身份(剔 ${dupes} 真重复);处理 ${reps.length}${DRY ? ' [dry-run]' : ''}`);

  if (!DRY) { fs.rmSync(OUT_DIR, { recursive: true, force: true }); fs.mkdirSync(OUT_DIR, { recursive: true }); }

  let ok = 0; const problems = [];
  const tz = new Set(); const langs = new Set(); const models = new Set(); const gpus = new Set();
  for (const { profile, base } of reps) {
    const issues = (await Profile.load(profile)).validate();
    if (issues.length) { problems.push({ base, issues }); continue; }
    if (!DRY) fs.writeFileSync(path.join(OUT_DIR, `${base}.json`), JSON.stringify(profile, null, 2));
    ok++;
    tz.add(profile.timezone.timeZone);
    langs.add((profile.navigator.languages || []).join(','));
    models.add(profile.navigator.userAgentData.model || '(empty)');
    gpus.add(profile.webgl?.unmaskedRenderer || '(none)');
  }

  console.log(`${DRY ? '校验通过' : `已写入 profiles/android-chrome/`} ${ok}/${reps.length}`);
  console.log(`多样性:${models.size} 机型 · ${tz.size} 时区 · ${langs.size} locale · ${gpus.size} GPU`);
  if (problems.length) {
    console.log(`\n${problems.length} 条 validate 失败(示例):`);
    for (const p of problems.slice(0, 10)) console.log(`  ✗ ${p.base}: ${p.issues.join('; ')}`);
    process.exitCode = 2;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
