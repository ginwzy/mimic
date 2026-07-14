import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { JsdomEngine } from '../../src/v2/engines/jsdom.js';
import { createNodeApplication } from '../../src/v2/node/app.js';
import {
  collectApplicationOracle,
  evaluateGoldenOracle,
  type V1Oracle,
} from '../../src/v2/quality/oracle.js';

const oraclePath = path.resolve('resources/v2/oracles/v1.json');

async function expected(): Promise<V1Oracle> {
  return JSON.parse(await readFile(oraclePath, 'utf8')) as V1Oracle;
}

function application() {
  const engine = new JsdomEngine();
  const app = createNodeApplication({
    engine,
    profilesRoot: path.resolve('profiles'),
    probePath: path.resolve('resources/v2/probe.js'),
    capture: { deadlineMs: 1_000, pollMs: 5, maxPosts: 5 },
  });
  return { app, engine };
}

test('Application preserves the fixed v1 behavior and execution golden corpus', async () => {
  const { app, engine } = application();
  const observation = await collectApplicationOracle(app);
  const gate = evaluateGoldenOracle(await expected(), observation);

  assert.deepEqual(gate.failures, []);
  assert.equal(gate.ok, true);
  assert.equal(engine.active, 0);
});

test('Application only applies the legacy unserializable placeholder to the exact realm window', async () => {
  const { app, engine } = application();
  const windowResult = await app.execute({
    profile: 'chrome-mac',
    job: { kind: 'run', code: 'window' },
  });
  assert.equal(windowResult.ok, true);
  assert.equal(windowResult.ok && windowResult.value, '[unserializable: [object Window]]');

  const documentResult = await app.execute({
    profile: 'chrome-mac',
    job: { kind: 'run', code: 'document' },
  });
  assert.equal(documentResult.ok, false);
  if (documentResult.ok) assert.fail('expected document encoding failure');
  assert.equal(documentResult.error.phase, 'encode');
  assert.equal(documentResult.error.code, 'ENCODE_FAILED');
  assert.equal(engine.active, 0);
});

test('Application reports missing globals and dynamic code when traced execution fails', async () => {
  const { app, engine } = application();
  const result = await app.execute({
    profile: 'chrome-mac',
    job: { kind: 'diagnose', code: `eval('1 + 2'); OracleMissing.value` },
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail('expected diagnosed execution failure');
  assert.match(result.error.message, /OracleMissing/);
  assert.deepEqual(result.report?.trace, {
    dynamicCode: [{ type: 'eval', code: '1 + 2' }],
    missing: ['OracleMissing'],
  });
  assert.equal(engine.active, 0);
});

test('Application dispatches each capture lifecycle event once', async () => {
  const { app, engine } = application();
  const result = await app.execute({
    profile: 'chrome-mac',
    job: {
      kind: 'capture',
      code: `window.addEventListener('load', () => navigator.sendBeacon('/load', '{"seg":"load"}'))`,
    },
  });

  assert.equal(result.ok, true);
  const value = result.ok ? result.value as { posts: Array<{ body: string | null }> } : undefined;
  assert.deepEqual(value?.posts.filter((post) => post.body === '{"seg":"load"}'), [
    { via: 'beacon', tag: '[object String]', len: 14, body: '{"seg":"load"}' },
  ]);
  assert.equal(engine.active, 0);
});
