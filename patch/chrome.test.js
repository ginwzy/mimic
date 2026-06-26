/**
 * patch/chrome.test.js —— window.chrome 标准扩展键 + Screen.prototype 扩展键自测。
 *   node patch/chrome.test.js
 *
 * 结构面(own 键集 / fn 形态)已由 harness/diff-gate.test.js 对真机基线守住;此处锁行为面:
 * loadTimes/csi 的老式 native 形态(name='' 但带 .prototype)+ 返回壳、app 结构、host 门控,以及
 * Screen 扩展键 availLeft/availTop/orientation 与 ScreenOrientation 单例(继承 EventTarget、可 addEventListener)。
 */
import { Realm } from '../core/realm.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const r = await Realm.create({ profile: 'chrome-mac' });
const C = JSON.parse(r.run(`(function(){
  const c = window.chrome;
  return JSON.stringify({
    keys: Object.getOwnPropertyNames(c),
    ltNative: c.loadTimes.toString().includes('[native code]'),
    ltName: c.loadTimes.name,
    ltLen: c.loadTimes.length,
    ltHasProto: Object.prototype.hasOwnProperty.call(c.loadTimes, 'prototype'),
    ltOwnNames: Object.getOwnPropertyNames(c.loadTimes).join(','),
    csiNative: c.csi.toString().includes('[native code]'),
    ltRet: c.loadTimes(),
    csiRet: c.csi(),
    appInstalled: c.app.isInstalled,
    appInstallState: c.app.InstallState,
    appRunningState: c.app.RunningState,
    appGetDetails: typeof c.app.getDetails,
    hasRuntime: 'runtime' in c,
    chromeProtoIsObject: Object.getPrototypeOf(c) === Object.prototype,
  });
})()`).value);

console.log('[window.chrome 标准扩展键]');
ok('own 键恰为 [loadTimes, csi, app]', C.keys.join(',') === 'loadTimes,csi,app');
ok('loadTimes toString 为 native', C.ltNative === true);
ok("loadTimes.name === ''(匿名)", C.ltName === '');
ok('loadTimes.length === 0', C.ltLen === 0);
ok('loadTimes 带 .prototype(老式 native 形态,异于普通 native 方法)', C.ltHasProto === true);
ok('loadTimes ownNames === length,name,prototype', C.ltOwnNames === 'length,name,prototype');
ok('csi toString 为 native', C.csiNative === true);
ok('loadTimes() 返时序壳(connectionInfo/wasNpnNegotiated)', C.ltRet.connectionInfo === 'h2' && C.ltRet.wasNpnNegotiated === true);
ok('csi() 返 {startE,onloadT,pageT,tran}', typeof C.csiRet.startE === 'number' && C.csiRet.tran === 15);
ok('app.isInstalled === false', C.appInstalled === false);
ok('app.InstallState 三值齐(NOT_INSTALLED=not_installed)', C.appInstallState.NOT_INSTALLED === 'not_installed');
ok('app.RunningState 三值齐(CANNOT_RUN=cannot_run)', C.appRunningState.CANNOT_RUN === 'cannot_run');
ok('app.getDetails 为函数', C.appGetDetails === 'function');
ok("无 runtime 键(真机无扩展页时不存在 → 不过度注入)", C.hasRuntime === false);
ok('getPrototypeOf(chrome) === window.Object.prototype(跨 realm 身份)', C.chromeProtoIsObject === true);

const S = JSON.parse(r.run(`(function(){
  const o = screen.orientation;
  return JSON.stringify({
    hasAvailLeft: 'availLeft' in screen, availLeft: screen.availLeft,
    hasAvailTop: 'availTop' in screen, availTop: screen.availTop,
    oType: o.type, oAngle: o.angle,
    oIsET: o instanceof EventTarget,
    oSame: screen.orientation === screen.orientation,
    oLock: typeof o.lock, oUnlock: typeof o.unlock,
    aelOk: (function(){ try { o.addEventListener('change', function(){}); return true; } catch(e){ return e.message; } })(),
    onchangeWritable: (function(){ try { o.onchange = function(){}; return o.onchange !== null; } catch(e){ return false; } })(),
    soGlobal: typeof window.ScreenOrientation,
    soIllegalCtor: (function(){ try { new window.ScreenOrientation(); return false; } catch(e){ return e instanceof TypeError; } })(),
    screenInstOwn: Object.getOwnPropertyNames(screen),
  });
})()`).value);

console.log('\n[Screen.prototype 扩展键 + ScreenOrientation]');
ok('Screen 有 availLeft(=0)', S.hasAvailLeft === true && S.availLeft === 0);
ok('Screen 有 availTop(=0)', S.hasAvailTop === true && S.availTop === 0);
ok('orientation.type/angle 自 profile(desktop 默认 landscape-primary/0)', S.oType === 'landscape-primary' && S.oAngle === 0);
ok('orientation instanceof EventTarget', S.oIsET === true);
ok('orientation 为单例(=== 不变量)', S.oSame === true);
ok('orientation.lock/unlock 为函数', S.oLock === 'function' && S.oUnlock === 'function');
ok('orientation.addEventListener 可调不抛 brand-check(brandless 生效)', S.aelOk === true);
ok('orientation.onchange 可写(strict 赋值不抛)', S.onchangeWritable === true);
ok('window.ScreenOrientation 全局存在', S.soGlobal === 'function');
ok('new ScreenOrientation() 抛 TypeError(illegal constructor)', S.soIllegalCtor === true);
ok('screen 实例无 own 键(扩展键住原型,非实例)', S.screenInstOwn.length === 0);

r.dispose();

// host 门控:webview 无 window.chrome。
const rw = await Realm.create({ profile: 'android-webview-v138' });
const noChrome = rw.run('typeof window.chrome').value;
rw.dispose();
console.log('\n[host 门控]');
ok('android-webview 下 window.chrome 不存在(host=webview 跳过)', noChrome === 'undefined');

console.log(`\nwindow.chrome + Screen 扩展键自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
