import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkRuntime } from '../src/quality/bench.js';
import { runLeakGate } from '../src/quality/leak.js';

test('runtime benchmark emits machine-readable metrics', async () => {
  const report = await benchmarkRuntime({
    iterations: 1,
    warmup: 0,
    rounds: 1,
    poolSize: 1,
    profiles: ['android-webview-v138'],
  });

  assert.equal(report.schema, 3);
  assert.equal(report.machine.platform, process.platform);
  assert.equal(report.machine.arch, process.arch);
  assert.equal(report.machine.node, process.version);
  assert.ok(report.machine.jsdom.length > 0);
  assert.ok(report.machine.cpu.model.length > 0);
  assert.ok(report.machine.cpu.logical > 0);
  assert.deepEqual(report.config.profiles, ['android-webview-v138']);
  const profile = report.runtime.profiles['android-webview-v138'];
  assert.ok(profile);
  assert.ok(profile.createMs.median > 0);
  assert.ok(profile.createMs.p95 > 0);
  assert.ok(profile.cycleThroughputPerSecond > 0);
  assert.ok(profile.worker.coldStartMs > 0);
  assert.ok(profile.worker.warmThroughputPerSecond > 0);
  assert.ok(report.runtime.rssMax > 0);
});

test('two-round leak gate proves application, executor, worker and child-process cleanup', async () => {
  const report = await runLeakGate({ tasksPerRound: 1, workerSize: 1, timeoutMs: 20_000 });

  assert.equal(report.schema, 1);
  assert.equal(report.gate.status, 'passed');
  assert.equal(report.child.naturallyExited, true);
  assert.equal(report.child.exitCode, 0);
  assert.equal(report.rounds.length, 2);
  for (const round of report.rounds) {
    assert.equal(round.application.engineActive, 0);
    assert.equal(round.executor.active, 0);
    assert.equal(round.executor.queued, 0);
  }
  assert.equal(report.final.application.engineActive, 0);
  assert.equal(report.final.executor.active, 0);
  assert.equal(report.final.executor.queued, 0);
  assert.equal(report.final.executor.idle, 0);
  assert.deepEqual(report.final.workers, { created: 2, terminated: 2, live: 0 });
  assert.equal(typeof report.memory.heapUsedDelta, 'number');
  assert.equal(typeof report.memory.rssDelta, 'number');
});
