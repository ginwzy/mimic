/**
 * RealmPool —— worker_threads 并行执行池。
 *
 * 单线程 realm 构建 ~30ms(patch 流水线占 ~79%,keyorder+window 两热点,微优化无效——是每个新 window 必付的
 * V8 属性功),吞吐 ~37/s。多 worker 并行提吞吐,但**次线性**:jsdom 分配密集 → 内存带宽/GC 跨 isolate 竞争,
 * 实测峰值约 3.6×(~140/s)落在 size≈物理核数,超过反而回退。零隔离风险(每 worker 内每任务 fresh realm)。
 * 冷启动:每 worker 各自加载整套 jsdom/mimic 图,只长驻池摊薄后才划算(短爆发更慢);生产按机器 benchmark 定 size。
 * 库承担 worker 边界的两处易错部分 —— realm 不能跨线程(整体活在 worker 内)+ 结果须序列化(见 entry/worker /
 * core/serialize);调用方只定池大小与喂任务。
 *
 *   import { RealmPool } from 'mimic';
 *   const pool = new RealmPool({ size: 8 });          // 省略 size 默认 max(1, 核数-1)
 *   const out = await pool.run({ code, profile: 'chrome-mac' });  // out 已 clone/JSON 安全
 *   await pool.destroy();
 *
 * 适用无状态单发任务。Session(跨多次 run 持有同一活 realm)需 worker 亲和,不走此池(另行支持)。
 */
import { Worker } from 'node:worker_threads';
import os from 'node:os';

const WORKER_URL = new URL('./worker.js', import.meta.url);
export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_QUEUE = 100;

function normalizeTimeout(value, name) {
  if (value == null) return undefined; // 编程调用可显式关闭 pool 默认超时;HTTP 层不开放此能力。
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} 必须是正整数(ms)`);
  return value;
}

function normalizeMaxQueue(value) {
  if (!Number.isInteger(value) || value < 0) throw new RangeError('maxQueue 必须是非负整数');
  return value;
}

export class QueueFullError extends Error {
  constructor(maxQueue) {
    super(`RealmPool 排队已满(maxQueue=${maxQueue})`);
    this.name = 'QueueFullError';
    this.code = 'ERR_REALM_POOL_QUEUE_FULL';
  }
}

export class RealmPool {
  constructor({
    size = Math.max(1, os.cpus().length - 1),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxQueue = DEFAULT_MAX_QUEUE,
  } = {}) {
    this._size = Math.max(1, size | 0);
    this._timeoutMs = normalizeTimeout(timeoutMs, 'timeoutMs');
    this._maxQueue = normalizeMaxQueue(maxQueue);
    this._workers = [];
    this._idle = [];           // 空闲 worker 栈
    this._queue = [];          // 待分派任务 { id, job }
    this._pending = new Map(); // id → { resolve, reject }
    this._seq = 0;
    this._destroyed = false;
    this._destroyPromise = null;
    for (let i = 0; i < this._size; i++) this._spawn();
  }

  get size() { return this._size; }
  get timeoutMs() { return this._timeoutMs; }
  get maxQueue() { return this._maxQueue; }
  /** 排队中(未分派)任务数,供调用方做背压判断。 */
  get pending() { return this._queue.length; }
  get queued() { return this._queue.length; }
  /** worker 正在执行的任务数。 */
  get active() { return this._workers.reduce((n, w) => n + (w._currentId == null ? 0 : 1), 0); }
  get stats() {
    return {
      size: this._size,
      active: this.active,
      idle: this._idle.length,
      queued: this._queue.length,
      maxQueue: this._maxQueue,
    };
  }

  /** @param {{code:string, profile?:string, url?:string, scriptUrl?:string, trace?:boolean, timeoutMs?:number|null}} job */
  run(job) {
    if (this._destroyed) return Promise.reject(new Error('RealmPool 已 destroy'));
    if (!job || typeof job.code !== 'string') return Promise.reject(new TypeError('run(job):job.code 必须是字符串'));
    let timeoutMs;
    try {
      timeoutMs = job.timeoutMs === undefined
        ? this._timeoutMs
        : normalizeTimeout(job.timeoutMs, 'job.timeoutMs');
    } catch (e) {
      return Promise.reject(e);
    }
    // maxQueue 只限制等待槽,不把当前有空闲 worker、可立即分派的任务误判为排队溢出。
    if (!this._idle.length && this._queue.length >= this._maxQueue) {
      return Promise.reject(new QueueFullError(this._maxQueue));
    }
    const id = ++this._seq;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._queue.push({ id, job: { ...job, timeoutMs } });
      this._drain();
    });
  }

  /** 优雅关闭:拒绝所有在途/排队任务并终止全部 worker。幂等。 */
  destroy() {
    if (this._destroyPromise) return this._destroyPromise;
    this._destroyed = true;
    const err = new Error('RealmPool 已 destroy');
    for (const [, p] of this._pending) p.reject(err);
    this._pending.clear();
    this._queue.length = 0;
    this._idle.length = 0;
    const workers = this._workers.splice(0);
    for (const w of workers) this._clearWatchdog(w);
    this._destroyPromise = Promise.all(workers.map((w) => w.terminate())).then(() => undefined);
    return this._destroyPromise;
  }

  _spawn() {
    const w = new Worker(WORKER_URL);
    w._currentId = null;
    w._timeoutMs = undefined;
    w._watchdog = null;
    w._down = false;
    w.on('message', ({ id, started, result }) => {
      if (w._down || this._destroyed || id !== w._currentId) return;
      if (started) {
        this._armWatchdog(w);
        return;
      }
      this._clearWatchdog(w);
      const p = this._pending.get(id);
      if (p) { this._pending.delete(id); p.resolve(result); }
      w._currentId = null;
      w._timeoutMs = undefined;
      if (this._destroyed) return;
      this._idle.push(w);
      this._drain();
    });
    w.on('error', (e) => this._onWorkerDown(w, e));
    w.on('exit', (code) => { if (code !== 0) this._onWorkerDown(w, new Error(`worker 异常退出 code=${code}`)); });
    this._workers.push(w);
    this._idle.push(w);
  }

  // worker 崩溃:在途任务随之失败(不静默丢),替补一个维持池容量。_down 守卫防 error+exit 双触发的重复替补。
  _onWorkerDown(w, err) {
    if (this._destroyed || w._down) return;
    w._down = true;
    this._clearWatchdog(w);
    if (w._currentId != null) {
      const p = this._pending.get(w._currentId);
      if (p) { this._pending.delete(w._currentId); p.reject(err); }
      w._currentId = null;
    }
    const iw = this._workers.indexOf(w); if (iw >= 0) this._workers.splice(iw, 1);
    const ii = this._idle.indexOf(w); if (ii >= 0) this._idle.splice(ii, 1);
    try { w.terminate(); } catch { /* noop */ }
    this._spawn();
    this._drain();
  }

  _armWatchdog(w) {
    this._clearWatchdog(w);
    if (w._timeoutMs === undefined) return;
    w._watchdog = setTimeout(() => {
      if (this._destroyed || w._down || w._currentId == null) return;
      const id = w._currentId;
      const p = this._pending.get(id);
      if (p) {
        this._pending.delete(id);
        p.resolve({ ok: false, error: `Script execution timed out after ${w._timeoutMs}ms`, missing: [] });
      }
      w._currentId = null;
      w._down = true;
      this._clearWatchdog(w);
      const iw = this._workers.indexOf(w); if (iw >= 0) this._workers.splice(iw, 1);
      const ii = this._idle.indexOf(w); if (ii >= 0) this._idle.splice(ii, 1);
      void w.terminate();
      this._spawn();
      this._drain();
    }, w._timeoutMs);
  }

  _clearWatchdog(w) {
    if (w._watchdog) clearTimeout(w._watchdog);
    w._watchdog = null;
  }

  _drain() {
    while (this._idle.length && this._queue.length) {
      const w = this._idle.pop();
      const { id, job } = this._queue.shift();
      w._currentId = id;
      w._timeoutMs = job.timeoutMs;
      try {
        w.postMessage({ id, ...job });
      } catch (e) {
        this._queue.unshift({ id, job }); // 放回队首交替补处理
        this._onWorkerDown(w, e);         // 其末尾会再 _drain
        return;
      }
    }
  }
}
