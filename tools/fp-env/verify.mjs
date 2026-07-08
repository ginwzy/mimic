/**
 * fp_env 保真度验证 —— 用生成的 profile 驱动 mimic,把回放出的环境与「该机真机采集」逐字段对账。
 *
 * 每个 android-chrome profile 的 meta.captureFile 指回其来源 z__env(真机 ↔ 真实 Akamai 输出的配对),
 * 故这是有 ground truth 的保真测试,非自洽自证:
 *   - navigator / screen / timezone / window 标量:profile 即采集值,回放须逐字段一致。
 *   - webgl getParameter 表 + extensions:patch/webgl.js 查表回放,须等于 collect1.getParameter_info[0]。
 *   - canvas / audio / fonts:mimic 标 fidelity:absent(渲染类,未回放)→ 报「未回放(设计如此)」,
 *     其真值留在 collect1,是日后键到检测器实际探针时的回放源/校验目标,不计入本轮失分。
 *
 * 用法(语料目录为必填绝对路径参数,取 ground truth):
 *   node tools/fp-env/verify.mjs /abs/path/to/fp_env                 # 池等距抽样验证(默认 40 条)
 *   node tools/fp-env/verify.mjs /abs/path/to/fp_env --all           # 验全池
 *   node tools/fp-env/verify.mjs /abs/path/to/fp_env --sample 100
 *   node tools/fp-env/verify.mjs /abs/path/to/fp_env android-chrome/sm-a556b-v139-11387 --verbose
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Realm } from '../../core/realm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const FP_ENV_DIR = argv.find((a) => a.startsWith('/')); // 语料目录:取 ground truth,显式给(必填)
const PROFILES_DIR = path.resolve(__dirname, '../../profiles');
const POOL_DIR = path.join(PROFILES_DIR, 'android-chrome');
const VERBOSE = argv.includes('--verbose');
const ALL = argv.includes('--all');
const SAMPLE = (() => { const i = argv.indexOf('--sample'); return i >= 0 ? Number(argv[i + 1]) : 40; })();
const named = argv.filter((a) => !a.startsWith('-') && !a.startsWith('/') && !/^\d+$/.test(a));

if (!FP_ENV_DIR) {
  console.error('用法:node tools/fp-env/verify.mjs /abs/path/to/fp_env [profile…] [--all|--sample N] [--verbose]\n需把 fp_env 采集目录作为绝对路径参数传入(取每个 profile 的 meta.captureFile 作真值对照)。');
  process.exit(1);
}

// collect.js 的 WebGL KEYS —— 与采集侧同集,确保对账口径一致。
const WEBGL_KEYS = [
  'VERSION', 'SHADING_LANGUAGE_VERSION', 'VENDOR', 'RENDERER',
  'MAX_TEXTURE_SIZE', 'MAX_VIEWPORT_DIMS', 'MAX_RENDERBUFFER_SIZE',
  'MAX_VERTEX_ATTRIBS', 'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS',
  'MAX_VARYING_VECTORS', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_TEXTURE_IMAGE_UNITS',
  'MAX_CUBE_MAP_TEXTURE_SIZE', 'ALIASED_LINE_WIDTH_RANGE', 'ALIASED_POINT_SIZE_RANGE',
];

const PROBE = `(async () => {
  const n = navigator, s = screen, out = { navigator:{}, screen:{}, timezone:{}, window:{}, webgl:null, uach:null };
  out.navigator = { userAgent:n.userAgent, platform:n.platform, languages:[...(n.languages||[])],
    hardwareConcurrency:n.hardwareConcurrency, deviceMemory:n.deviceMemory, maxTouchPoints:n.maxTouchPoints };
  // UA-CH —— 本语料唯一区分轴(UA 被冻结成 Android 10;K,真差异全在 model/platformVersion/fullVersionList)。
  // model/platformVersion 等高熵仅在 getHighEntropyValues(Promise)里,故探针 async + harness await。
  if (n.userAgentData) {
    const u = n.userAgentData;
    const h = await u.getHighEntropyValues(['architecture','bitness','model','platformVersion','uaFullVersion','fullVersionList']);
    out.uach = { brands: JSON.parse(JSON.stringify(u.brands)), mobile: u.mobile, platform: u.platform,
      architecture: h.architecture, bitness: h.bitness, model: h.model, platformVersion: h.platformVersion,
      uaFullVersion: h.uaFullVersion, fullVersionList: JSON.parse(JSON.stringify(h.fullVersionList)) };
  }
  out.screen = { width:s.width, height:s.height, availWidth:s.availWidth, availHeight:s.availHeight,
    colorDepth:s.colorDepth, pixelDepth:s.pixelDepth };
  out.timezone = { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: new Date().getTimezoneOffset() };
  out.window = { innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio };
  try {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    if (gl) {
      const KEYS = ${JSON.stringify(WEBGL_KEYS)};
      const params = {};
      for (const k of KEYS) { try { if (gl[k] !== undefined) {
        const v = gl.getParameter(gl[k]);
        params[gl[k]] = (v && typeof v !== 'string' && typeof v.length === 'number') ? Array.from(v) : v;
      } } catch(e) {} }
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      let uv, ur;
      if (dbg) { uv = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL); ur = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL); }
      out.webgl = { params, extensions: gl.getSupportedExtensions(), unmaskedVendor: uv, unmaskedRenderer: ur };
    }
  } catch(e) { out.webglError = String(e); }
  return out;
})()`;

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 逐字段对账,push 到 res。 */
function diff(res, section, key, got, want) {
  res.total++;
  if (eq(got, want)) { res.ok++; return; }
  res.fails.push({ section, key, got, want });
}

async function verifyOne(profileName) {
  const profPath = path.join(PROFILES_DIR, `${profileName}.json`);
  const prof = JSON.parse(fs.readFileSync(profPath, 'utf-8'));
  const captureFile = prof.meta?.captureFile;
  if (!captureFile) return { profileName, skipped: '无 meta.captureFile' };
  const real = JSON.parse(fs.readFileSync(path.join(FP_ENV_DIR, captureFile), 'utf-8'));

  const realm = await Realm.create({ profile: profileName });
  let probe;
  try {
    const r = realm.run(PROBE);
    if (!r.ok) return { profileName, error: `probe 抛:${r.value}` };
    probe = await r.value; // 探针 async(UA-CH getHighEntropyValues 是 Promise)→ dispose 前必须先 await
  } finally { realm.dispose?.(); }

  const res = { profileName, captureFile, total: 0, ok: 0, fails: [] };
  const rn = real.navigator || {}, rs = real.screen || {};

  diff(res, 'navigator', 'userAgent', probe.navigator.userAgent, rn.userAgent);
  diff(res, 'navigator', 'platform', probe.navigator.platform, rn.platform);
  diff(res, 'navigator', 'languages', probe.navigator.languages, rn.languages);
  diff(res, 'navigator', 'hardwareConcurrency', probe.navigator.hardwareConcurrency, rn.hardwareConcurrency);
  diff(res, 'navigator', 'deviceMemory', probe.navigator.deviceMemory, rn.deviceMemory);
  diff(res, 'navigator', 'maxTouchPoints', probe.navigator.maxTouchPoints, rn.maxTouchPoints);

  // UA-CH 对账 —— 真值在 navigator.userAgentData.HighEntropyValues(本语料价值所在)。
  const rh = (rn.userAgentData && rn.userAgentData.HighEntropyValues) || null;
  if (rh && probe.uach) {
    diff(res, 'uach', 'brands', probe.uach.brands, rh.brands);
    diff(res, 'uach', 'mobile', probe.uach.mobile, rh.mobile);
    diff(res, 'uach', 'platform', probe.uach.platform, rh.platform);
    diff(res, 'uach', 'model', probe.uach.model, rh.model);
    diff(res, 'uach', 'platformVersion', probe.uach.platformVersion, rh.platformVersion);
    diff(res, 'uach', 'uaFullVersion', probe.uach.uaFullVersion, rh.uaFullVersion);
    diff(res, 'uach', 'fullVersionList', probe.uach.fullVersionList, rh.fullVersionList);
    diff(res, 'uach', 'architecture', probe.uach.architecture, rh.architecture);
    diff(res, 'uach', 'bitness', probe.uach.bitness, rh.bitness);
  } else if (rh && !probe.uach) {
    res.fails.push({ section: 'uach', key: '(navigator.userAgentData)', got: 'undefined', want: '存在' });
    res.total++;
  }

  for (const k of ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth']) {
    diff(res, 'screen', k, probe.screen[k], rs[k]);
  }

  diff(res, 'timezone', 'timeZone', probe.timezone.timeZone, real['Intl.Timezone']);
  diff(res, 'timezone', 'offset', probe.timezone.offset, real.Date?.TimezoneOffset);

  for (const k of ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio']) {
    diff(res, 'window', k, probe.window[k], real[k]);
  }

  // webgl:probe.params 按 enum 数字键 ↔ collect1.getParameter_info[0] 同键。
  const gp = real.collect1 && Array.isArray(real.collect1.getParameter_info) ? real.collect1.getParameter_info[0] : null;
  if (gp && probe.webgl) {
    for (const [enumNum, v] of Object.entries(probe.webgl.params)) {
      diff(res, 'webgl.param', enumNum, v, gp[enumNum]);
    }
    diff(res, 'webgl', 'unmaskedVendor', probe.webgl.unmaskedVendor, gp['37445']);
    diff(res, 'webgl', 'unmaskedRenderer', probe.webgl.unmaskedRenderer, gp['37446']);
    diff(res, 'webgl', 'extensions', probe.webgl.extensions, real.collect1.canvas_webgl2_SupportedExtensions);
  } else if (probe.webgl == null) {
    res.fails.push({ section: 'webgl', key: '(context)', got: 'getContext→null', want: 'WebGL 上下文' });
    res.total++;
  }
  return res;
}

async function main() {
  let names = named;
  if (!names.length) {
    const all = fs.readdirSync(POOL_DIR).filter((f) => f.endsWith('.json'))
      .map((f) => `android-chrome/${f.replace(/\.json$/, '')}`).sort();
    if (!ALL && all.length > SAMPLE) {
      // 跨排序列表等距抽样(非前 N)→ 覆盖机型/时区/locale 多样性,几十条即足证映射均匀正确。
      const stride = all.length / SAMPLE;
      names = Array.from({ length: SAMPLE }, (_, i) => all[Math.floor(i * stride)]);
      console.log(`池 ${all.length} 条,等距抽样 ${names.length}(--all 验全量)\n`);
    } else { names = all; }
  }
  if (!names.length) { console.error('无 profiles/android-chrome/ profile,先跑 tools/fp-env/adapt.mjs'); process.exit(1); }

  let gTotal = 0, gOk = 0; const perfect = [];
  for (const name of names) {
    const res = await verifyOne(name);
    if (res.skipped) { console.log(`  ⊘ ${name} —— ${res.skipped}`); continue; }
    if (res.error) { console.log(`  ✗ ${name} —— ${res.error}`); continue; }
    gTotal += res.total; gOk += res.ok;
    const rate = res.total ? ((res.ok / res.total) * 100).toFixed(1) : '0';
    const mark = res.fails.length ? '✗' : '✓';
    if (!res.fails.length) perfect.push(name);
    console.log(`  ${mark} ${name.padEnd(44)} ${res.ok}/${res.total} (${rate}%)`);
    if (res.fails.length && (VERBOSE || names.length === 1)) {
      for (const f of res.fails.slice(0, 30)) {
        console.log(`      ${f.section}.${f.key}: 回放=${JSON.stringify(f.got)} 真机=${JSON.stringify(f.want)}`);
      }
      if (res.fails.length > 30) console.log(`      …还有 ${res.fails.length - 30} 项`);
    }
  }
  console.log(`\n汇总:${perfect.length}/${names.length} profile 全字段保真;字段级 ${gOk}/${gTotal} (${((gOk / gTotal) * 100).toFixed(1)}%)`);
  console.log('注:canvas/audio/fonts 标 fidelity:absent(渲染类未回放),真值留在 collect1,不计入上面口径。');
  if (gOk !== gTotal) process.exitCode = 2;
}

main().catch((e) => { console.error(e); process.exit(1); });
