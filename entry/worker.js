/**
 * worker_threads 入口 —— 每收一个任务在本 worker 内建 realm、执行、序列化回传、dispose。
 *
 * 为何 realm 必须整体活在 worker 内:jsdom window 不能跨线程传递(非可克隆);结果经 serializeResult 归一成
 * clone 安全数据再 postMessage(直接回传活 DOM / 循环引用会抛 DataCloneError)。默认每任务 fresh realm,
 * 跨任务零状态泄漏 —— 并行来自"N 个 worker"而非"复用 realm",故无隔离风险。
 *
 * 由 entry/pool.js 经 `new Worker(new URL('./worker.js', ...))` 加载,不直接运行。
 */
import { parentPort } from 'node:worker_threads';
import { Realm } from '../core/realm.js';
import { serializeResult } from '../core/serialize.js';

if (!parentPort) throw new Error('entry/worker.js 只能作为 worker_threads 加载(见 entry/pool.js)');

// job:{ id, code, profile, url?, scriptUrl?, trace?, timeoutMs? }
//   url       —— 文档域(cookie/origin 落地);scriptUrl —— 脚本在 stack 帧中的来源 URL(见 Realm.run)。
parentPort.on('message', async ({ id, code, profile, url, scriptUrl, trace, timeoutMs }) => {
  let realm = null;
  let result;
  try {
    realm = await Realm.create({ profile, url, trace: !!trace });
    parentPort.postMessage({ id, started: true });
    result = serializeResult(realm.run(code, { url: scriptUrl, timeoutMs }));
  } catch (e) {
    // 装配/序列化失败也必须走下方统一 checkpoint；否则恶意 Proxy 可在序列化 getter 中排入死 microtask，
    // catch 先回包后令 pool 清 watchdog，把 worker 永久卡死。
    let message = 'Worker task failed';
    try { message = e?.message ?? String(e); } catch { /* 恶意错误对象 getter */ }
    result = { ok: false, error: message, missing: [] };
  }
  // 页面可改写 window.close；dispose 使用 create 期可信引用并先取消页面 timer，不能把用户回调带入 checkpoint。
  realm?.dispose();
  realm = null;
  // 宏任务边界保证递归排入的 Promise microtask 全部耗尽；单次 await Promise.resolve 的 continuation 可能
  // 插在后续 microtask 之前，仍可被绕过。卡死时 pool watchdog 会终止本 worker 并补位。
  await new Promise((resolve) => setImmediate(resolve));
  parentPort.postMessage({ id, result });
});
