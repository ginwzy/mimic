import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  Catalog,
  compile,
  JsdomEngine,
  LegacyProfiles,
  parseJob,
  parseProfile,
  parseShape,
  seal,
} from '../src/index.js';
import { traceDriver, traceFeature, traceShape } from '../src/features/trace.js';

const store = new LegacyProfiles(path.resolve('profiles'));

async function open(enabled: boolean) {
  const imported = await store.load('chrome-mac');
  const { hash: _shapeHash, ...shapeBody } = imported.shape;
  const base = parseShape(seal({
    ...shapeBody,
    features: [],
    ops: [],
    support: { structure: imported.shape.support.structure || imported.shape.level },
  }));
  const shape = traceShape(base);
  const { hash: _profileHash, ...profileBody } = imported.profile;
  const profile = parseProfile(seal({ ...profileBody, shape: { id: shape.id, hash: shape.hash } }));
  const engine = new JsdomEngine();
  const plan = compile({
    profile,
    ...(imported.page ? { page: imported.page } : {}),
    catalog: Catalog.create('trace-test', [shape], [traceFeature]),
    job: parseJob({ kind: 'diagnose', code: 'void 0', trace: enabled }),
    engine: engine.manifest,
    drivers: ['trace'],
  });
  return { engine, plan, runtime: engine.open(plan, { trace: traceDriver }) };
}

test('trace records dynamic eval and Function source without changing callable shape', async () => {
  const { engine, plan, runtime } = await open(true);
  try {
    const result = runtime.run(`JSON.stringify((() => {
      const evalValue = eval('debugger; 1 + 2');
      const called = Function('value', 'debugger; return value * 2');
      const made = new Function('value', 'return value + 1');
      return {
        values: [evalValue, called(4), made(4)],
        identity: [Function.prototype.constructor === Function, called instanceof Function, made instanceof Function],
        shape: [
          [eval.name, eval.length, eval.toString(), Object.hasOwn(eval, 'prototype')],
          [Function.name, Function.length, Function.toString(), Object.hasOwn(Function, 'prototype')],
        ],
      };
    })())`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      values: [3, 8, 5],
      identity: [true, true, true],
      shape: [
        ['eval', 1, 'function eval() { [native code] }', false],
        ['Function', 1, 'function Function() { [native code] }', true],
      ],
    });
    assert.equal(plan.support['trace.capture'], 'emulated');
    const report = runtime.report() as {
      trace: { dynamicCode: Array<{ type: string; code?: string; args?: string[] }> };
    };
    assert.deepEqual(report, {
      trace: {
        dynamicCode: [
          { type: 'eval', code: 'debugger; 1 + 2' },
          { type: 'Function', args: ['value', 'debugger; return value * 2'] },
          { type: 'Function', args: ['value', 'return value + 1'] },
        ],
      },
    });
    report.trace.dynamicCode.length = 0;
    assert.equal((runtime.report().trace as { dynamicCode: unknown[] }).dynamicCode.length, 3);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('trace leaves eval and Function untouched when the Job does not enable tracing', async () => {
  const { engine, plan, runtime } = await open(false);
  try {
    const result = runtime.run(`JSON.stringify([eval('1 + 2'), Function('return 4')(), Function.prototype.constructor === Function])`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), [3, 4, true]);
    assert.equal(plan.support['trace.capture'], 'unsupported');
    assert.deepEqual(runtime.report(), {});
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});
