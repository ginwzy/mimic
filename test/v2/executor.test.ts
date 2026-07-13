import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { parseResult } from '../../src/v2/index.js';
import { QueueFullError, WorkerExecutor } from '../../src/v2/executor/pool.js';

const profilesRoot = path.resolve('profiles');
const probePath = path.resolve('harness/probe.js');
const request = (code: string, timeout?: number) => ({
  profile: 'android-webview-v138',
  job: { kind: 'run' as const, code, ...(timeout === undefined ? {} : { timeout }) },
});

function executor(options: { timeoutMs?: number; maxQueue?: number } = {}) {
  return new WorkerExecutor({
    profilesRoot,
    probePath,
    size: 1,
    timeoutMs: options.timeoutMs ?? 3_000,
    maxQueue: options.maxQueue ?? 1,
    capture: { deadlineMs: 50, pollMs: 5, maxPosts: 1 },
  });
}

function timed(result: Awaited<ReturnType<WorkerExecutor['run']>>): boolean {
  return !result.ok && result.error.code === 'RUN_FAILED' && /timed out|timeout/i.test(result.error.message);
}

test('WorkerExecutor rejects invalid concurrency instead of silently coercing it', () => {
  for (const size of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => new WorkerExecutor({ profilesRoot, probePath, size }), /positive integer/);
  }
});

test('WorkerExecutor returns clone-safe Results and recovers after sync and microtask deadlocks', async () => {
  const pool = executor();
  try {
    const first = await pool.run(request('6 * 7'));
    assert.deepEqual(parseResult(first), first);
    assert.equal(first.ok && first.value, 42);

    assert.equal(timed(await pool.run(request('while (true) {}', 100))), true);
    assert.equal(timed(await pool.run(request(`Promise.resolve().then(() => { while (true) {} }); 1`, 100))), true);

    const recovered = await pool.run(request('40 + 2'));
    assert.equal(recovered.ok && recovered.value, 42);
    assert.equal((await pool.run(request('globalThis.__mimicPolluted = 1; 1'))).ok, true);
    const isolated = await pool.run(request('typeof globalThis.__mimicPolluted'));
    assert.equal(isolated.ok && isolated.value, 'undefined');
    assert.deepEqual(pool.stats, { size: 1, active: 0, idle: 1, queued: 0, maxQueue: 1 });
  } finally {
    await pool.destroy();
  }
});

test('WorkerExecutor watchdog covers serialization traps and close pollution', async () => {
  const pool = executor();
  try {
    const trapped = await pool.run(request(`new Proxy({}, {
      ownKeys() {
        Promise.resolve().then(() => { while (true) {} });
        throw new Error('serialize');
      }
    })`, 100));
    assert.equal(timed(trapped), true);

    const poisoned = await pool.run(request('window.close = () => { while (true) {} }; 1'));
    assert.equal(poisoned.ok && poisoned.value, 1);
    const asyncPoisoned = await pool.run(request(`window.close = () => {
      Promise.resolve().then(() => { while (true) {} });
    }; 2`));
    assert.equal(asyncPoisoned.ok && asyncPoisoned.value, 2);
    assert.equal((await pool.run(request('21 * 2'))).ok, true);
  } finally {
    await pool.destroy();
  }
});

test('WorkerExecutor bounds queued work and replaces timed-out workers', async () => {
  const pool = executor({ timeoutMs: 3_000, maxQueue: 1 });
  try {
    const running = pool.run(request(`Promise.resolve().then(() => { while (true) {} }); 1`, 100));
    const waiting = pool.run(request('6 * 7'));
    assert.equal(pool.active, 1);
    assert.equal(pool.queued, 1);
    await assert.rejects(
      pool.run(request('99')),
      (error: unknown) => error instanceof QueueFullError && error.code === 'ERR_MIMIC_QUEUE_FULL',
    );
    const [timeout, next] = await Promise.all([running, waiting]);
    assert.equal(timed(timeout), true);
    assert.equal(next.ok && next.value, 42);
  } finally {
    await pool.destroy();
  }

  assert.deepEqual(pool.workerLifecycle, { created: 2, terminated: 2, live: 0 });

  await assert.rejects(pool.run(request('1')), /destroy/);
});

test('WorkerExecutor preserves parent-side planning errors as validated Results', async () => {
  const pool = executor();
  try {
    const result = await pool.run({ profile: '', job: { kind: 'run', code: '1' } });
    assert.equal(result.ok, false);
    if (result.ok) assert.fail('expected planning failure');
    assert.equal(result.error.phase, 'parse');
    assert.equal(result.error.code, 'BAD_PROFILE');
    assert.deepEqual(pool.stats, { size: 1, active: 0, idle: 1, queued: 0, maxQueue: 1 });
  } finally {
    await pool.destroy();
  }
});

test('WorkerExecutor starts one worker and scales to the configured concurrency on demand', async () => {
  const pool = new WorkerExecutor({ profilesRoot, probePath, size: 3, timeoutMs: 5_000, maxQueue: 3 });
  try {
    assert.equal(pool.stats.idle, 1);
    const pending = [pool.run(request('1')), pool.run(request('2')), pool.run(request('3'))];
    assert.equal(pool.active, 3);
    const results = await Promise.all(pending);
    assert.deepEqual(results.map((result) => result.ok && result.value), [1, 2, 3]);
    assert.equal(pool.stats.idle, 3);
  } finally {
    await pool.destroy();
  }
});

test('WorkerExecutor does not count unstarted worker capacity against maxQueue zero', async () => {
  const pool = new WorkerExecutor({ profilesRoot, probePath, size: 3, timeoutMs: 5_000, maxQueue: 0 });
  try {
    const accepted = [pool.run(request('1')), pool.run(request('2')), pool.run(request('3'))];
    await assert.rejects(pool.run(request('4')), QueueFullError);
    assert.deepEqual((await Promise.all(accepted)).map((result) => result.ok && result.value), [1, 2, 3]);
  } finally {
    await pool.destroy();
  }
});
