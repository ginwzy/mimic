/**
 * harness/test.js —— diff 引擎回归测试(锁住对抗审查修复的三处 gate 正确性 bug)。
 *   node harness/test.js
 */
import { diff, summarize } from './diff.js';
import { classify } from './whitelist.js';
import { hostOf } from './server.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const complete = (targets) => ({ meta: { complete: true }, targets });
const fnT = (id, fn) => ({ id, category: 'function', resolved: true, fn });

// —— Fix 1:EXTRA 泄漏(target/键)必须阻断 gate ——
{
  const base = complete([{ id: 'window.chrome', category: 'object', kind: 'instance', resolved: false }]);
  const mim = complete([{ id: 'window.chrome', category: 'object', kind: 'instance', resolved: true, tag: '[object Object]', protoChain: ['Object.prototype'], ownKeys: [], symbolKeys: [], keys: {} }]);
  const s = summarize(diff(base, mim));
  ok('EXTRA target 泄漏(基线无、mimic 有)→ gate FAIL', s.gatePass === false && s.counts.EXTRA >= 1);
}

// —— Fix 1b:complete 基线里 mimic 多出的 own 键 → EXTRA fatal,阻断 ——
{
  const objBase = { id: 'Navigator.prototype', category: 'object', kind: 'prototype', resolved: true, tag: '[object Navigator]', protoChain: ['Object.prototype'], ownKeys: ['userAgent'], symbolKeys: [], keys: { userAgent: { type: 'accessor', flags: { enumerable: true, configurable: true }, accessor: { get: { name: 'get userAgent', length: 0, toStringNative: true, hasOwnToString: false, hasPrototype: false }, set: null } } } };
  const objMim = JSON.parse(JSON.stringify(objBase));
  objMim.ownKeys = ['userAgent', '__leak__'];
  objMim.keys.__leak__ = { type: 'data', flags: { writable: true, enumerable: true, configurable: true }, valueType: 'number' };
  const s = summarize(diff(complete([objBase]), complete([objMim])));
  ok('EXTRA own 键(mimic 独有)→ gate FAIL', s.gatePass === false && s.counts.EXTRA >= 1);
}

// —— Fix 2:访问器半边缺失(基线有 getter、mimic 为 null)→ TELL 阻断,而非被 yvq.6 白名单吞 ——
{
  const acc = (get) => ({ id: 'Navigator.prototype', category: 'object', kind: 'prototype', resolved: true, tag: '[object Navigator]', protoChain: ['Object.prototype'], ownKeys: ['userAgent'], symbolKeys: [], keys: { userAgent: { type: 'accessor', flags: { enumerable: true, configurable: true }, accessor: { get, set: null } } } });
  const base = complete([acc({ name: 'get userAgent', length: 0, toStringNative: true, hasOwnToString: false, hasPrototype: false })]);
  const mim = complete([acc(null)]);
  const entries = diff(base, mim);
  const e = entries.find((x) => x.field.indexOf('accessor.get') === 0);
  const s = summarize(entries);
  ok('访问器半边缺失 → TELL(非 MISSING)', !!e && e.bucket === 'TELL');
  ok('访问器半边缺失 → 未被白名单 → gate FAIL', !!e && !e.whitelist && s.gatePass === false);
}

// —— Fix 3:ownNames 白名单只放行"恰多出 prototype",夹带泄漏键则不放行 ——
{
  const legit = { targetId: 'window.atob', t1: true, key: null, field: 'fn.ownNames', bucket: 'TELL', baseline: 'length,name', mimic: 'length,name,prototype' };
  const evil = { targetId: 'window.atob', t1: true, key: null, field: 'fn.ownNames', bucket: 'TELL', baseline: 'length,name', mimic: 'evilLeak,length,name,prototype' };
  const substr = { targetId: 'window.atob', t1: true, key: null, field: 'fn.ownNames', bucket: 'TELL', baseline: 'length,name', mimic: 'length,name,prototypeFoo' };
  ok('ownNames 恰多出 prototype → 白名单 yvq.11', classify(legit) === 'yvq.11');
  ok('ownNames 夹带 evilLeak → 不白名单', classify(evil) === null);
  ok('ownNames 仅子串 prototypeFoo → 不白名单', classify(substr) === null);
}

// —— sanity:length 不一致(种子场景)→ 未白名单 TELL → gate FAIL ——
{
  const base = complete([fnT('window.moveBy', { name: 'moveBy', length: 2, toStringNative: true, hasOwnToString: false, hasPrototype: false })]);
  const mim = complete([fnT('window.moveBy', { name: 'moveBy', length: 0, toStringNative: true, hasOwnToString: false, hasPrototype: true })]);
  const entries = diff(base, mim);
  const lenTell = entries.find((e) => e.field === 'fn.length');
  const s = summarize(entries);
  ok('length 不一致 → TELL 阻断', !!lenTell && lenTell.bucket === 'TELL' && !lenTell.whitelist && s.gatePass === false);
  ok('hasPrototype 残留 → 落 yvq.11 白名单', entries.some((e) => e.field === 'fn.hasPrototype' && e.whitelist === 'yvq.11'));
}

// —— MISSING 永不阻断 gate ——
{
  const base = complete([fnT('window.fetch', { name: 'fetch', length: 1, toStringNative: true, hasOwnToString: false, hasPrototype: false })]);
  const mim = complete([{ id: 'window.fetch', category: 'function', resolved: false }]);
  const s = summarize(diff(base, mim));
  ok('MISSING(jsdom 缺)→ gate 不阻断 + 落 yvq.6', s.gatePass === true && s.counts.MISSING === 1);
}

// —— yvq.19:harness host 判定用 probe 的 window.chrome target.resolved(非 UA)——
{
  const viaUA = 'Mozilla/5.0 (Linux; Android 15; M2012K11AC Build/x) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.7204.63 Mobile Safari/537.36';
  ok('hostOf: window.chrome resolved:false(via)→ webview',
    hostOf({ targets: [{ id: 'window.chrome', resolved: false }], meta: { ua: viaUA } }) === 'webview');
  ok('hostOf: window.chrome resolved:true → chrome',
    hostOf({ targets: [{ id: 'window.chrome', resolved: true }], meta: { ua: 'x' } }) === 'chrome');
  ok('hostOf: 无 target → 回退 UA(含 wv → webview)',
    hostOf({ targets: [], meta: { ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) Version/4.0 Chrome/131 Mobile Safari/537.36' } }) === 'webview');
}

console.log(`\nharness 回归:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
