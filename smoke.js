/**
 * 最小冒烟测试:验证 Realm 能创建、patch 能改造、伪装是否生效。手动演示(console-log 快照),非 CI 门
 * —— 跨 realm 身份/结构不变量由 npm test 内的 diff-gate + eventtarget/ctoriface/domproto 断言守护。
 *   node smoke.js
 */
import { Realm } from './entry/index.js';

const realm = await Realm.create({ profile: 'chrome-mac' });

const checks = {
  'navigator.userAgent': realm.run('navigator.userAgent'),
  'navigator.platform': realm.run('navigator.platform'),
  'navigator.webdriver': realm.run('navigator.webdriver'),
  'screen.colorDepth': realm.run('screen.colorDepth'),
  // 反检测:getter 的 toString 应返回 [native code]
  'UA getter native': realm.run(
    "Object.getOwnPropertyDescriptor(Navigator.prototype,'userAgent').get.toString()"
  ),
  // 类型标签
  'connection instanceof': realm.run('navigator.connection instanceof NetworkInformation'),
  // 确定性
  'Math.random#1': realm.run('Math.random()'),
  'Date.now': realm.run('Date.now()'),
  'window.chrome': realm.run('typeof window.chrome'),

  // —— 跨 realm 身份判别检查(期望全 true,否则 Akamai 可一眼识破)——
  'conn instanceof Object': realm.run('navigator.connection instanceof Object'),
  'getter instanceof Func': realm.run(
    "Object.getOwnPropertyDescriptor(Navigator.prototype,'userAgent').get instanceof Function"
  ),
  'languages instanceof Arr': realm.run('navigator.languages instanceof Array'),
  'hasOwnProp intrinsic': realm.run(
    'navigator.connection.hasOwnProperty === Object.prototype.hasOwnProperty'
  ),
};

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k.padEnd(24)} →`, v.ok ? v.value : `ERR: ${v.error}`);
}
realm.dispose();

// —— 平台差异:同一套 patch,traits 驱动出两个不同环境 ——
console.log('\n── 平台差异(traits 门控)──');
for (const name of ['chrome-mac', 'android-webview']) {
  const r = await Realm.create({ profile: name });
  const t = r.traits;
  console.log(`\n[${name}]  host=${t.host} formFactor=${t.formFactor} platform=${t.platform}`);
  console.log('  window.chrome    :', r.run('typeof window.chrome').value);
  console.log('  window.orientation:', r.run('window.orientation').value);
  console.log('  maxTouchPoints   :', r.run('navigator.maxTouchPoints').value);
  console.log('  applied patches  :', r.describe().patches.filter((p) => p.applied).map((p) => p.name).join(', '));
  console.log('  skipped patches  :', r.describe().patches.filter((p) => !p.applied).map((p) => `${p.name}(${p.reason})`).join(', ') || '(无)');
  r.dispose();
}
