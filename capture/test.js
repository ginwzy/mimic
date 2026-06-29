/**
 * capture/test.js —— host 判定回归(锁住 UA-wv 过载 → window.chrome 结构信号)。
 *   node capture/test.js
 * 覆盖 detectHost 信号优先级 · deriveTraits/suggestName 端到端 · Profile.validate host 自洽。
 */
import { detectHost, deriveTraits, suggestName } from './derive.js';
import { Profile } from '../core/profile.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// 真实 UA 样本:via(改 UA 去 wv 的 WebView)/ 标准 WebView(含 wv)/ 桌面 Chrome。
const UA = {
  via: 'Mozilla/5.0 (Linux; Android 15; M2012K11AC Build/BP1A.250505.005) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.7204.63 Mobile Safari/537.36',
  wv: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
};
const CHROME_KEYS = { ownKeys: ['loadTimes', 'csi', 'app'] };

// —— detectHost:结构信号(window.chrome)优先,UA 仅回退 ——
ok('detectHost: via(window.chrome=null, UA 无 wv) → webview',
  detectHost({ window: { chrome: null }, navigator: { userAgent: UA.via } }) === 'webview');
ok('detectHost: Chrome(有 window.chrome) → chrome',
  detectHost({ window: { chrome: CHROME_KEYS }, navigator: { userAgent: UA.desktop } }) === 'chrome');
ok('detectHost: 结构优先 — UA 含 wv 但有 window.chrome → chrome',
  detectHost({ window: { chrome: CHROME_KEYS }, navigator: { userAgent: UA.wv } }) === 'chrome');
ok('detectHost: 标准 WebView(window.chrome=null, UA 有 wv) → webview',
  detectHost({ window: { chrome: null }, navigator: { userAgent: UA.wv } }) === 'webview');
ok('detectHost: window.chrome=null 优先于 userAgentData → webview',
  detectHost({ window: { chrome: null }, navigator: { userAgent: UA.via, userAgentData: { brands: [] } } }) === 'webview');

// —— detectHost:无结构信号(老数据)的回退链 ——
ok('detectHost: 老数据(无 window.chrome 字段)+ userAgentData → chrome',
  detectHost({ navigator: { userAgent: UA.via, userAgentData: { brands: [] } } }) === 'chrome');
ok('detectHost: 老数据 + UA 无 wv → 回退 chrome',
  detectHost({ navigator: { userAgent: UA.desktop } }) === 'chrome');
ok('detectHost: 老数据 + UA 有 wv → 回退 webview',
  detectHost({ navigator: { userAgent: UA.wv } }) === 'webview');

// —— deriveTraits + suggestName 端到端(via 应落 android-webview-v138)——
{
  const traits = deriveTraits({ navigator: { userAgent: UA.via }, window: { chrome: null } });
  ok('deriveTraits(via) → host=webview', traits.host === 'webview');
  ok('deriveTraits(via) → android/mobile/v138',
    traits.platform === 'android' && traits.formFactor === 'mobile' && traits.version === 138);
  ok('suggestName(via) → android-webview-v138(webview 不加 mobile)',
    suggestName(traits) === 'android-webview-v138');
}

// —— Profile.validate:host 自洽改用 window.chrome 结构事实 ——
// chrome: undefined=老数据(不写键) · null=采到无 · 对象=采到有
function prof({ host, ua, chrome }) {
  const win = {};
  if (chrome !== undefined) win.chrome = chrome;
  return new Profile({
    meta: { traits: { engine: 'chromium', platform: 'android', formFactor: 'mobile', host } },
    navigator: { userAgent: ua, platform: 'Linux armv8l' },
    window: win,
  });
}
const hostProblems = (p) => p.validate().filter((s) => /window\.chrome|含 wv/.test(s));

ok('validate: via(host=webview + window.chrome=null) → 无 host 矛盾',
  hostProblems(prof({ host: 'webview', ua: UA.via, chrome: null })).length === 0);
ok('validate: host=chrome + window.chrome=null → 报矛盾',
  hostProblems(prof({ host: 'chrome', ua: UA.via, chrome: null })).some((s) => s.includes('host=chrome 但采集数据无 window.chrome')));
ok('validate: host=webview + 有 window.chrome → 报矛盾',
  hostProblems(prof({ host: 'webview', ua: UA.via, chrome: CHROME_KEYS })).some((s) => s.includes('host=webview 但采集数据有 window.chrome')));
ok('validate: 老数据 host=chrome + UA 含 wv → 单向兜底报矛盾',
  hostProblems(prof({ host: 'chrome', ua: UA.wv, chrome: undefined })).some((s) => s.includes('host=chrome 但 UA 含 wv')));
ok('validate: 老数据 host=webview + UA 无 wv → 放行(via 类不再被拦)[关键回归]',
  hostProblems(prof({ host: 'webview', ua: UA.via, chrome: undefined })).length === 0);

console.log(`\ncapture host 判定回归:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
