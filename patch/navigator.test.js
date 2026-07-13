/**
 * Navigator 平台 API 与 keyorder 回归。
 *
 * macOS 顺序直接对照真机 baseline。Android Chrome 当前没有结构 baseline,这里只锁住由 Chrome host 表与
 * 已知 mobile 差异合成的稳定表;它防止运行时 extra append 漂移,不证明 Android Chrome 真机完整顺序。
 */
import fs from 'node:fs';
import { Realm } from '../core/realm.js';
import { NAVIGATOR_ORDER } from './keyorder.js';
import { DOCUMENT_ORDER, HTML_ELEMENT_ORDER } from './keyorder-data.js';

let pass = 0; let failed = 0;
function ok(name, condition) {
  if (condition) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

function baselineKeys(name, targetId) {
  const baseline = JSON.parse(fs.readFileSync(new URL(`../harness/baselines/${name}.json`, import.meta.url), 'utf8'));
  return baseline.targets.find((target) => target.id === targetId)?.ownKeys;
}

async function snapshot(profile) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let realm;
  try {
    realm = await Realm.create({ profile });
    const result = realm.run(`(function () {
      const own = (proto, key) => Object.prototype.hasOwnProperty.call(proto, key);
      const nativeZero = (fn) => typeof fn === 'function' && fn.length === 0 &&
        Function.prototype.toString.call(fn).includes('[native code]') &&
        Object.getOwnPropertyNames(fn).join(',') === 'length,name';
      const bluetoothDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'bluetooth');
      return {
        navigatorKeys: Object.getOwnPropertyNames(Navigator.prototype),
        documentKeys: Object.getOwnPropertyNames(Document.prototype),
        htmlElementKeys: Object.getOwnPropertyNames(HTMLElement.prototype),
        hasBluetooth: own(Navigator.prototype, 'bluetooth'),
        hasCanShare: own(Navigator.prototype, 'canShare'),
        hasShare: own(Navigator.prototype, 'share'),
        hasBluetoothGlobal: typeof Bluetooth === 'function',
        bluetoothTag: navigator.bluetooth && Object.prototype.toString.call(navigator.bluetooth),
        bluetoothEventTarget: navigator.bluetooth instanceof EventTarget,
        bluetoothSingleton: navigator.bluetooth === navigator.bluetooth,
        bluetoothMethods: navigator.bluetooth && ['getAvailability', 'getDevices', 'requestDevice']
          .every((key) => typeof navigator.bluetooth[key] === 'function'),
        bluetoothGetterShape: !!bluetoothDesc && nativeZero(bluetoothDesc.get) && bluetoothDesc.set == null,
        canShareShape: nativeZero(navigator.canShare),
        shareShape: nativeZero(navigator.share),
        canShareValue: typeof navigator.canShare === 'function' ? navigator.canShare({ text: 'x' }) : null,
        shareThenable: typeof navigator.share === 'function' ? typeof navigator.share({ text: 'x' }).then === 'function' : null,
        hasContacts: own(Navigator.prototype, 'contacts'),
        hasWindowControlsOverlay: own(Navigator.prototype, 'windowControlsOverlay'),
      };
    })()`);
    if (!result.ok) throw new Error(result.error);
    return { ...result.value, warnings };
  } finally {
    realm?.dispose();
    console.warn = originalWarn;
  }
}

console.log('[macOS Chrome Navigator 真机基线]');
for (const version of [148, 149]) {
  const name = `macos-chrome-v${version}`;
  const result = await snapshot(name);
  const expected = baselineKeys(name, 'Navigator.prototype');
  ok(`${name}:Navigator own-key order 与真机 baseline 逐项一致`,
    JSON.stringify(result.navigatorKeys) === JSON.stringify(expected));
  ok(`${name}:含 bluetooth/canShare/share`, result.hasBluetooth && result.hasCanShare && result.hasShare);
  ok(`${name}:Bluetooth 全局/标签/EventTarget 形态`,
    result.hasBluetoothGlobal && result.bluetoothTag === '[object Bluetooth]' && result.bluetoothEventTarget);
  ok(`${name}:navigator.bluetooth 保持单例身份`, result.bluetoothSingleton);
  ok(`${name}:Bluetooth 核心方法与 getter native shape`, result.bluetoothMethods && result.bluetoothGetterShape);
  ok(`${name}:canShare length0/native 且返回 false`, result.canShareShape && result.canShareValue === false);
  ok(`${name}:share length0/native 且返回 Promise-like`, result.shareShape && result.shareThenable);
}

console.log('\n[严格平台门控]');
for (const profile of ['linux-chrome', 'android-webview-v138', 'android-chrome/sm-s901b-v138-10021']) {
  const result = await snapshot(profile);
  ok(`${profile}:不注入 bluetooth/canShare/share`,
    !result.hasBluetooth && !result.hasCanShare && !result.hasShare && !result.hasBluetoothGlobal);
}

console.log('\n[Android Chrome 合成 keyorder 边界]');
const android = await snapshot('android-chrome/sm-s901b-v138-10021');
ok('Android Chrome mobile 轴含 contacts 且不含 windowControlsOverlay',
  android.hasContacts && !android.hasWindowControlsOverlay);
ok('Navigator 使用 androidChrome 表,无 contacts 尾部 append 漂移',
  JSON.stringify(android.navigatorKeys) === JSON.stringify(NAVIGATOR_ORDER.androidChrome));
ok('Document 使用 androidChrome 表,无 touch handler 尾部 append 漂移',
  JSON.stringify(android.documentKeys) === JSON.stringify(DOCUMENT_ORDER.androidChrome));
ok('HTMLElement 使用 androidChrome 表,无 touch handler 尾部 append 漂移',
  JSON.stringify(android.htmlElementKeys) === JSON.stringify(HTML_ELEMENT_ORDER.androidChrome));
ok('三个目标不再报告 keyorder 键集漂移',
  !android.warnings.some((line) => /Navigator|Document|HTMLElement/.test(line) && /own 键集合漂移/.test(line)));

console.log(`\nnavigator/keyorder 自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
