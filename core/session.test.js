/**
 * core/session.test.js —— Session 出口捕获自测(确定性 gate;harness 不实例化 Session,故此为其唯一回归门)。
 *   node core/session.test.js
 *
 * 用合成目标脚本逐一压每条出口路径 —— 这是 Session 出口捕获的**通过/失败**判据(真实 ANA BMS 是观察性的,不在此 gate):
 *   ① 同步段 XHR.send(run() 内即捕获 → syncCaptured)
 *   ② load 回调里的 XHR.send(事件驱动捕获)
 *   ③ navigator.sendBeacon
 *   ④ fetch(u,{body})
 *   ⑤ setTimeout 异步 XHR.send(证明轮询确实在驱动事件循环,而非只读同步段)
 * 外加 native 保真:拦截壳 toString 仍为 native、arity 不变、instanceof 不破(整体替换 XHR 的旧法会破这些)。
 */
import { Session } from './session.js';
import { Realm } from './realm.js';

let pass = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// 合成目标:覆盖 5 条出口路径(同源 example.com,避免 jsdom open 的 URL/CORS 杂音)。
const TARGET = `
  // ① 同步段 XHR
  (function(){ var x = new XMLHttpRequest(); x.open('POST','https://example.com/sync'); x.send(JSON.stringify({seg:'sync'})); })();
  // ②③④⑤ 异步:load 回调内同步发 + 一个延时发
  window.addEventListener('load', function(){
    var x = new XMLHttpRequest(); x.open('POST','https://example.com/load'); x.send(JSON.stringify({seg:'load', sensor:'AAAA'}));
    navigator.sendBeacon('https://example.com/beacon', JSON.stringify({seg:'beacon'}));
    fetch('https://example.com/fetch', { method:'POST', body: JSON.stringify({seg:'fetch'}) });
    setTimeout(function(){
      var x2 = new XMLHttpRequest(); x2.open('POST','https://example.com/timer'); x2.send(JSON.stringify({seg:'timer', late:true}));
    }, 50);
  });
`;

console.log('[Session 出口捕获 — 5 路径合成 gate]');

// 纯 Realm 基线 arity:用于断言"hook 保留原 arity"(jsdom 原生 send.length=0,真机为 1 —— jsdom 既有差异,
// 不在本测试范围;关键是 hook 不得**改变**它,否则拦截层自身成新 tell)。
const plain = await Realm.create({ profile: 'chrome-mac' });
const baseSendLen = plain.run('XMLHttpRequest.prototype.send.length').value;
const baseFetchLen = plain.run('window.fetch.length').value;
plain.dispose();

const sess = await Session.create({ profile: 'chrome-mac' });

// ── native 保真:在 Session-active realm 上显式断言(smoke/diff 不实例化 Session,查不到这些 tell)──
const nat = sess.realm.run(`(function(){
  return JSON.stringify({
    sendNative: XMLHttpRequest.prototype.send.toString().indexOf('[native code]') >= 0,
    sendLen: XMLHttpRequest.prototype.send.length,
    xhrInstanceof: (new XMLHttpRequest()) instanceof XMLHttpRequest,
    fetchNative: window.fetch.toString().indexOf('[native code]') >= 0,
    fetchLen: window.fetch.length,
    beaconNative: navigator.sendBeacon.toString().indexOf('[native code]') >= 0,
  });
})()`).value;
const n = JSON.parse(nat);
ok('XHR.send 仍 native(toString 不泄漏实现)', n.sendNative === true);
ok(`XHR.send.length 不被 hook 改变(=${baseSendLen})`, n.sendLen === baseSendLen);
ok('new XMLHttpRequest instanceof XMLHttpRequest(身份不破)', n.xhrInstanceof === true);
ok(`fetch 仍 native + arity 不变(=${baseFetchLen})`, n.fetchNative === true && n.fetchLen === baseFetchLen);
ok('navigator.sendBeacon 仍 native', n.beaconNative === true);

// ── 捕获:maxPosts 抬高 + deadline 给足,让 setTimeout(50) 的异步 POST 也能进轮询 ──
const r = await sess.capture(TARGET, { scriptUrl: 'https://example.com/target.js', maxPosts: 5, deadlineMs: 3000 });
sess.dispose();

// 段命中:某段是否被捕获(经 body 内的 "seg":"<name>" 判定)。注:jsdom 自发 load + 本层 driveEvents 哑派发
// 可能令 load/timer 段被捕获多次(重复无害,取首个非空为 payload;按段去重判路径正确性,不硬编总数)。
const hasSeg = (name) => r.posts.some((p) => p.via === (name === 'beacon' ? 'beacon' : name === 'fetch' ? 'fetch' : 'xhr') && p.body && p.body.indexOf(`"${name}"`) >= 0);
const distinctSegs = new Set(r.posts.filter((p) => p.body).map((p) => (p.body.match(/"seg":"(\w+)"/) || [])[1]).filter(Boolean));
console.log('\n[捕获结果]');
console.log('  posts:', JSON.stringify(r.posts.map((p) => ({ via: p.via, len: p.len }))));
console.log('  distinct segs:', [...distinctSegs].join(','));
ok('run 成功(ok)', r.ok === true);
ok('① 同步段 XHR 落在 run 内(syncCaptured)', r.syncCaptured === true);
ok('captured 为首个非空请求体(同步 sync 段)', typeof r.captured === 'string' && r.captured.indexOf('"sync"') >= 0);
ok('② load 回调 XHR 捕获', hasSeg('load'));
ok('③ sendBeacon 捕获', hasSeg('beacon'));
ok('④ fetch(body) 捕获', hasSeg('fetch'));
ok('⑤ setTimeout 异步 XHR 捕获(轮询确在驱动事件循环)', hasSeg('timer'));
ok('5 条出口路径(sync/load/beacon/fetch/timer)全部各捕获至少一次', ['sync', 'load', 'beacon', 'fetch', 'timer'].every((s) => distinctSegs.has(s)));

console.log(`\nSession 出口捕获自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
