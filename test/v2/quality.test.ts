import assert from 'node:assert/strict';
import test from 'node:test';
import {
  benchmarkCutover,
  comparePerformance,
  type MachineFingerprint,
  type PerformanceSnapshot,
} from '../../src/v2/quality/bench.js';
import { runLeakGate } from '../../src/v2/quality/leak.js';

const machine: MachineFingerprint = {
  platform: 'linux',
  arch: 'x64',
  node: 'v24.0.0',
  jsdom: '29.1.1',
  cpu: { model: 'fixture cpu', logical: 8 },
};

function snapshot(overrides: Partial<PerformanceSnapshot['profiles']['fixture']> = {}): PerformanceSnapshot {
  return {
    machine,
    profiles: {
      fixture: {
        createMs: { median: 100, p95: 200 },
        cycleThroughputPerSecond: 100,
        worker: { coldStartMs: 500, warmThroughputPerSecond: 50 },
        ...overrides,
      },
    },
    rssMax: 1_000,
  };
}

test('performance comparator enforces the 20% budget only on an identical machine fingerprint', () => {
  const within = comparePerformance(snapshot(), snapshot({
    createMs: { median: 120, p95: 240 },
    cycleThroughputPerSecond: 80,
    worker: { coldStartMs: 600, warmThroughputPerSecond: 40 },
  }));
  assert.equal(within.status, 'passed');
  assert.equal(within.claimable, true);
  assert.equal(within.threshold, 0.2);
  assert.equal(within.checks.length, 6);
  assert.equal(within.checks.every((check) => check.passed), true);

  const regressed = comparePerformance(snapshot(), {
    ...snapshot({ createMs: { median: 121, p95: 200 } }),
    rssMax: 1_201,
  });
  assert.equal(regressed.status, 'failed');
  assert.deepEqual(
    regressed.checks.filter((check) => !check.passed).map((check) => check.metric),
    ['profiles.fixture.createMs.median', 'rssMax'],
  );

  const mismatched = comparePerformance(snapshot(), {
    ...snapshot(),
    machine: { ...machine, arch: 'arm64' },
  });
  assert.deepEqual(mismatched, {
    status: 'skipped',
    claimable: false,
    threshold: 0.2,
    reason: 'machine fingerprint mismatch; a performance claim is not permitted',
    checks: [],
  });
});

test('cutover benchmark emits comparable v1/v2 machine-readable metrics', async () => {
  const report = await benchmarkCutover({
    iterations: 1,
    warmup: 0,
    rounds: 1,
    poolSize: 1,
    profiles: ['android-webview-v138'],
  });

  assert.equal(report.schema, 2);
  assert.equal(report.machine.platform, process.platform);
  assert.equal(report.machine.arch, process.arch);
  assert.equal(report.machine.node, process.version);
  assert.ok(report.machine.jsdom.length > 0);
  assert.ok(report.machine.cpu.model.length > 0);
  assert.ok(report.machine.cpu.logical > 0);
  assert.deepEqual(report.config.profiles, ['android-webview-v138']);
  for (const measured of [report.v1, report.v2]) {
    const profile = measured.profiles['android-webview-v138'];
    assert.ok(profile);
    assert.ok(profile.createMs.median > 0);
    assert.ok(profile.createMs.p95 > 0);
    assert.ok(profile.cycleThroughputPerSecond > 0);
    assert.ok(profile.worker.coldStartMs > 0);
    assert.ok(profile.worker.warmThroughputPerSecond > 0);
    assert.ok(measured.rssMax > 0);
  }
  assert.notEqual(report.gate.status, 'skipped');
  assert.equal(report.gate.checks.length, 6);
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
