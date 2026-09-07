import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createNodeApplication } from '../src/node/app.js';
import { createMimic } from '../src/sdk.js';

const profilesRoot = path.resolve('test/fixtures/fp-env');
const probePath = path.resolve('resources/probe.js');

test('SDK planning and listing do not create workers, and close is safe before execution', async () => {
  const mimic = createMimic({ profile: 'android-webview/unknown-v138-1', profilesRoot, probePath, size: 1 });
  try {
    assert.ok((await mimic.list('profiles')).includes('android-webview/unknown-v138-1'));
    const job = { kind: 'run' as const, code: '42' };
    const plan = await mimic.plan(job);
    assert.deepEqual(mimic.executor.workerLifecycle, { created: 0, terminated: 0, live: 0 });
    const result = await mimic.run(job);
    assert.equal(result.ok && result.value, 42);
    assert.equal(result.plan, plan.id);
    assert.deepEqual(mimic.executor.workerLifecycle, { created: 1, terminated: 0, live: 1 });
  } finally {
    await mimic.close();
  }
  assert.deepEqual(mimic.executor.workerLifecycle, { created: 1, terminated: 1, live: 0 });

  const unused = createMimic({ profile: 'android-webview/unknown-v138-1', profilesRoot, size: 1 });
  await unused.close();
  await unused.close();
  assert.deepEqual(unused.executor.workerLifecycle, { created: 0, terminated: 0, live: 0 });
  await assert.rejects(unused.run({ kind: 'run', code: '1' }), /destroyed/);
  assert.throws(() => createMimic({ capture: { deadlineMs: 0 } }), /positive integer/);
});

test('SDK and in-process Application preserve identical Job/Result semantics', async () => {
  const app = createNodeApplication({ profilesRoot, probePath });
  const mimic = createMimic({
    profile: 'android-webview/unknown-v138-1',
    profilesRoot,
    probePath,
    size: 1,
    timeoutMs: 5_000,
    maxQueue: 1,
  });
  const job = { kind: 'run' as const, code: '({ answer: 6 * 7, ua: navigator.userAgent })' };
  try {
    const [direct, worker] = await Promise.all([
      app.execute({ profile: 'android-webview/unknown-v138-1', job }),
      mimic.run(job),
    ]);
    assert.deepEqual(worker, direct);

    const plan = await mimic.plan(job);
    assert.equal(plan.id, worker.plan);
    assert.ok((await mimic.list('profiles')).includes('android-webview/unknown-v138-1'));
  } finally {
    await mimic.close();
    await mimic.close();
  }
});

test('SDK methods enforce task kinds while sharing one configured context', async () => {
  const mimic = createMimic({
    profile: 'android-webview/unknown-v138-1', profilesRoot, probePath, size: 1, timeoutMs: 5_000,
    capture: { deadlineMs: 50, pollMs: 5, maxPosts: 1 },
  });
  try {
    const capture = await mimic.capture({
      kind: 'capture',
      code: `navigator.sendBeacon('/collect', 'sdk-body')`,
    });
    assert.equal(capture.ok, true);
    assert.equal(capture.ok && (capture.value as { captured?: string }).captured, 'sdk-body');

    const probe = await mimic.probe({ kind: 'probe' });
    assert.equal(probe.ok, true);
    assert.ok(probe.ok && Array.isArray((probe.value as { targets?: unknown[] }).targets));

    const diagnose = await mimic.diagnose({ kind: 'diagnose', code: `eval('1 + 1')` });
    assert.deepEqual(diagnose.report?.trace, { dynamicCode: [{ type: 'eval', code: '1 + 1' }] });

    await assert.rejects(
      mimic.run({ kind: 'capture', code: '1' } as never),
      /run requires a run Job/,
    );
  } finally {
    await mimic.close();
  }
});
