import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { digest, JsdomEngine, parsePage, parseResult, seal } from '../src/index.js';
import { createNodeApplication } from '../src/node/app.js';

const profilesRoot = path.resolve('profiles');
const probePath = path.resolve('resources/probe.js');

function application() {
  const engine = new JsdomEngine();
  const app = createNodeApplication({
    engine,
    profilesRoot,
    probePath,
    capture: { deadlineMs: 100, pollMs: 5, maxPosts: 1 },
  });
  return { app, engine };
}

test('Application executes run and returns one validated Result contract', async () => {
  const { app, engine } = application();
  const result = await app.execute({
    profile: 'android-webview-v138',
    job: { kind: 'run', code: '({ answer: 6 * 7, realm: Object.getPrototypeOf([]) === Array.prototype })' },
  });

  assert.deepEqual(parseResult(result), result);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { answer: 42, realm: true });
  assert.equal(result.report, undefined);
  assert.equal(engine.active, 0);
});

test('Application capture drives lifecycle events and returns the network report', async () => {
  const { app, engine } = application();
  const result = await app.execute({
    profile: 'android-webview-v138',
    job: {
      kind: 'capture',
      code: `window.addEventListener('load', () => navigator.sendBeacon('/collect', 'event-body')); 'ready'`,
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    syncCaptured: false,
    captured: 'event-body',
    posts: [{ via: 'beacon', tag: '[object String]', len: 10, body: 'event-body' }],
  });
  assert.deepEqual(result.report?.net, {
    body: 'event-body',
    posts: [{ via: 'beacon', tag: '[object String]', len: 10, body: 'event-body' }],
  });
  assert.equal(engine.active, 0);
});

test('Application probe and diagnose are task dispatches over the same Result boundary', async () => {
  const { app, engine } = application();
  const probe = await app.execute({ profile: 'android-webview-v138', job: { kind: 'probe' } });
  assert.equal(probe.ok, true);
  assert.equal((probe.value as { meta?: { probeVersion?: number } }).meta?.probeVersion, 1);
  assert.ok(Array.isArray((probe.value as { targets?: unknown[] }).targets));

  const diagnose = await app.execute({
    profile: 'android-webview-v138',
    job: { kind: 'diagnose', code: `eval('20 + 22')`, trace: false },
  });
  assert.equal(diagnose.ok, true);
  assert.equal(diagnose.value, 42);
  assert.deepEqual(diagnose.report?.trace, { dynamicCode: [{ type: 'eval', code: '20 + 22' }] });
  assert.equal(engine.active, 0);
});

test('Application normalizes failures, plans, and profile listing without leaking Runtime state', async () => {
  const { app, engine } = application();
  const request = { profile: 'android-webview-v138', job: { kind: 'run' as const, code: 'throw new Error("boom")' } };
  const plan = await app.plan(request);
  const result = await app.execute(request);

  assert.equal(result.ok, false);
  if (result.ok) assert.fail('expected failure');
  assert.equal(result.plan, plan.id);
  assert.equal(result.error.phase, 'run');
  assert.equal(result.error.code, 'RUN_FAILED');
  assert.match(result.error.message, /boom/);
  assert.ok((await app.list('profiles')).includes('android-webview-v138'));
  assert.ok((await app.list('features')).includes('net'));
  assert.ok((await app.list('drivers')).includes('trace'));
  assert.equal(engine.active, 0);
});

test('Application reuses an identical immutable Job plan without crossing Job boundaries', async () => {
  const { app } = application();
  const request = {
    profile: 'android-webview-v138',
    job: { kind: 'run' as const, code: '1 + 1', timeout: 1_000 },
  };

  const first = await app.plan(request);
  const repeated = await app.plan(structuredClone(request));
  const differentCode = await app.plan({ ...request, job: { ...request.job, code: '2 + 2' } });
  const capture = await app.plan({
    profile: request.profile,
    job: { kind: 'capture', code: request.job.code },
  });

  assert.equal(repeated, first);
  assert.notEqual(differentCode, first);
  assert.deepEqual(differentCode, first);
  assert.notEqual(capture.id, first.id);
});

test('Application overlays Page fields while inheriting omitted Profile Page state', async () => {
  const { app, engine } = application();
  const now = 1_735_689_600_123;
  const page = parsePage(seal({
    schema: 2 as const,
    id: 'clock-override',
    source: { kind: 'manual' as const, hash: digest('app-page-clock-override') },
    clock: { now, seed: 0x1234_5678 },
  }));
  const request = {
    profile: 'android-webview-v138',
    page,
    job: {
      kind: 'run' as const,
      code: `({
        now: Date.now(),
        connection: [
          navigator.connection.effectiveType,
          navigator.connection.downlink,
          navigator.connection.rtt,
          navigator.connection.saveData,
        ],
      })`,
    },
  };

  const plan = await app.plan(request);
  const result = await app.execute(request);

  assert.equal(plan.page?.id, page.id);
  assert.notEqual(plan.page?.hash, page.hash);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    now,
    connection: ['4g', 9.1, 0, false],
  });
  assert.equal(engine.active, 0);
});
