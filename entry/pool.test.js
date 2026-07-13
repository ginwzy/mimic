/**
 * entry/pool.test.js —— RealmPool worker 池自测。
 *   node entry/pool.test.js
 *
 * 覆盖:结果正确性 / 同步脚本超时 / 序列化边界 / 有界排队背压 / destroy 后拒绝。
 */
import { RealmPool } from './pool.js';
import { Realm } from '../core/realm.js';

let pass = 0; let fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`); } };

console.log('[RealmPool worker 池自测]');
const pool = new RealmPool({ size: 2 });
ok('size 生效', pool.size === 2);
ok('pool 默认同步超时为 5 秒', pool.timeoutMs === 5_000);
ok('pool 默认队列有界', Number.isInteger(pool.maxQueue) && pool.maxQueue > 0);

// 直接 Realm API 省略 timeoutMs 仍保持原语义;显式 timeoutMs 才限制同步执行。
const direct = await Realm.create({ profile: 'android-webview-v138' });
ok('Realm.run 省略 timeoutMs 正常执行', direct.run('20 + 22').value === 42);
const directTimeout = direct.run('while (true) {}', { timeoutMs: 25 });
ok('Realm.run 显式 timeoutMs 中断无限循环', !directTimeout.ok && /timed out|timeout/i.test(directTimeout.error));
direct.dispose();

const jobs = [
  { code: '1 + 1', expect: (r) => r.ok && r.value === 2 },
  { code: 'navigator.userAgent', expect: (r) => r.ok && typeof r.value === 'string' && r.value.length > 0 },
  { code: 'document.body.tagName', expect: (r) => r.ok && r.value === 'BODY' },
  { code: '({ a: 1, b: [2, 3] })', expect: (r) => r.ok && r.value && r.value.a === 1 && Array.isArray(r.value.b) },
  { code: 'throw new Error("boom")', expect: (r) => !r.ok && /boom/.test(r.error) },
  { code: 'window', expect: (r) => r.ok && typeof r.value === 'string' && r.value.includes('unserializable') },
];
const results = await Promise.all(jobs.map((j) => pool.run({ profile: 'android-webview-v138', code: j.code })));
jobs.forEach((j, i) => ok(`job[${i}] ${j.code.slice(0, 24)}`, j.expect(results[i])));
ok('每个结果带 missing 数组', results.every((r) => Array.isArray(r.missing)));

// 并发 8 > 池容量 2:全部 resolve、结果各对(验证队列 + round-robin)。
const many = await Promise.all(Array.from({ length: 8 }, (_, i) => pool.run({ profile: 'android-webview-v138', code: `${i} * 2` })));
ok('并发 8 > 池 2 全 resolve 且各对', many.every((r, i) => r.ok && r.value === i * 2));
ok('任务完成后计数归零', pool.active === 0 && pool.queued === 0 && pool.stats.idle === 2);

await pool.destroy();
let rejected = false;
try { await pool.run({ profile: 'android-webview-v138', code: '1' }); } catch { rejected = true; }
ok('destroy 后 run 拒绝', rejected);

// 一个任务在执行、一个任务在等待时,第三个任务须立即拒绝,不能让内存队列无界增长。
const bounded = new RealmPool({ size: 1, timeoutMs: 50, maxQueue: 1 });
const running = bounded.run({ profile: 'android-webview-v138', code: 'while (true) {}' });
const waiting = bounded.run({ profile: 'android-webview-v138', code: '6 * 7' });
ok('计数区分执行中与排队中', bounded.active === 1 && bounded.queued === 1);
let fullError = null;
try {
  await bounded.run({ profile: 'android-webview-v138', code: '99' });
} catch (e) {
  fullError = e;
}
ok('队列满立即以稳定错误码拒绝', fullError?.code === 'ERR_REALM_POOL_QUEUE_FULL');
const [timed, waited] = await Promise.all([running, waiting]);
ok('pool 超时贯穿 worker → Realm.run', !timed.ok && /timed out|timeout/i.test(timed.error));
ok('超时后 worker 继续处理队列', waited.ok && waited.value === 42);
await bounded.destroy();

const noWaiting = new RealmPool({ size: 1, timeoutMs: 30, maxQueue: 0 });
const only = noWaiting.run({ profile: 'android-webview-v138', code: 'while (true) {}' });
let noSlotError = null;
try {
  await noWaiting.run({ profile: 'android-webview-v138', code: '1' });
} catch (e) {
  noSlotError = e;
}
ok('maxQueue=0 时第二个并发任务立即拒绝', noSlotError?.code === 'ERR_REALM_POOL_QUEUE_FULL');
await only;
const afterTimeout = await noWaiting.run({ profile: 'android-webview-v138', code: '40 + 2' });
ok('maxQueue=0 的超时任务后仍可继续执行', afterTimeout.ok && afterTimeout.value === 42);
await noWaiting.destroy();

// Promise microtask 在 vm.runInContext 返回后才执行；pool 必须等 microtask checkpoint，并在其卡死时杀 worker。
const microtasks = new RealmPool({ size: 1, timeoutMs: 50, maxQueue: 1 });
const microtaskLoop = await microtasks.run({
  profile: 'android-webview-v138',
  code: `Promise.resolve().then(() => {
    Promise.resolve().then(() => {
      Promise.resolve().then(() => { while (true) {} });
    });
  }); 1`,
});
ok('Promise microtask 死循环不能先返回假成功',
  !microtaskLoop.ok && /timed out|timeout/i.test(microtaskLoop.error));
const afterMicrotask = await microtasks.run({ profile: 'android-webview-v138', code: '40 + 2' });
ok('microtask 超时后替补 worker 可继续执行', afterMicrotask.ok && afterMicrotask.value === 42);
await microtasks.destroy();

// 序列化异常也必须走同一 checkpoint。Proxy 让 JSON.stringify 抛后,再在 toStringTag trap 排入死 microtask。
const serializeTrap = new RealmPool({ size: 1, timeoutMs: 50, maxQueue: 1 });
const trapped = await serializeTrap.run({
  profile: 'android-webview-v138',
  code: `new Proxy({}, {
    get(target, key) {
      if (key === 'toJSON') return () => { throw new Error('serialize'); };
      if (key === Symbol.toStringTag) {
        Promise.resolve().then(() => { while (true) {} });
        throw new Error('tag');
      }
    }
  })`,
});
ok('序列化异常路径也不能绕过 microtask watchdog',
  !trapped.ok && /timed out|timeout/i.test(trapped.error));
const afterTrap = await serializeTrap.run({ profile: 'android-webview-v138', code: '40 + 2' });
ok('序列化 trap 超时后替补 worker 可继续执行', afterTrap.ok && afterTrap.value === 42);
await serializeTrap.destroy();

// 页面可改写 window.close；Realm.dispose 必须使用 create 期捕获的可信原始 close。
const disposeTrap = new RealmPool({ size: 1, timeoutMs: 50, maxQueue: 1 });
const poisonedClose = await disposeTrap.run({
  profile: 'android-webview-v138',
  code: 'window.close = () => { while (true) {} }; 1',
});
ok('同步 close 污染不影响可信销毁', poisonedClose.ok && poisonedClose.value === 1);
const asyncPoisonedClose = await disposeTrap.run({
  profile: 'android-webview-v138',
  code: 'window.close = () => { Promise.resolve().then(() => { while (true) {} }); }; 2',
});
ok('异步 close 污染不能在 dispose 后排入死 microtask',
  asyncPoisonedClose.ok && asyncPoisonedClose.value === 2);
const afterDisposeTrap = await disposeTrap.run({ profile: 'android-webview-v138', code: '40 + 2' });
ok('close 污染后 worker 可继续执行', afterDisposeTrap.ok && afterDisposeTrap.value === 42);
await disposeTrap.destroy();

console.log(`\nRealmPool 自测:${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
