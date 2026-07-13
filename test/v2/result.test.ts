import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  encodeResult,
  MimicError,
  parseResult,
  type Result,
} from '../../src/v2/index.js';

const plan = 'a'.repeat(64);
const support = { structure: 'derived' } as const;

test('Result codec clones JSON values and omits undefined from the wire', () => {
  const value = { answer: 42, nested: [true, null] };
  const encoded = encodeResult({ ok: true, value, plan, support });

  assert.deepEqual(encoded, {
    ok: true,
    value: { answer: 42, nested: [true, null] },
    plan,
    support,
  });
  assert.notEqual(encoded.ok && encoded.value, value);

  const missing = encodeResult({ ok: true, value: undefined, plan, support });
  assert.deepEqual(missing, { ok: true, plan, support });
  assert.equal(Object.hasOwn(missing, 'value'), false);

  const parsed: Result = parseResult(JSON.parse(JSON.stringify(missing)));
  assert.deepEqual(parsed, missing);
});

test('encodeResult accepts plain values created in another Realm', () => {
  const value = runInNewContext('({ answer: 42, nested: [true, null] })') as unknown;

  assert.deepEqual(encodeResult({ ok: true, value, plan, support }), {
    ok: true,
    value: { answer: 42, nested: [true, null] },
    plan,
    support,
  });
});

test('Result codec clones and recursively freezes an optional diagnostic report', () => {
  const report = { trace: { events: [{ op: 'get', path: 'window.navigator' }] }, count: 1 };
  const encoded = encodeResult({ ok: true, value: 42, report, plan, support });

  assert.deepEqual(encoded, { ok: true, value: 42, report, plan, support });
  assert.equal(encoded.ok, true);
  assert.notEqual(encoded.report, report);
  assert.notEqual(encoded.report?.trace, report.trace);
  assert.equal(Object.isFrozen(encoded.report), true);
  assert.equal(Object.isFrozen(encoded.report?.trace), true);
  assert.equal(Object.isFrozen((encoded.report?.trace as { events: unknown[] }).events), true);

  report.trace.events[0]!.path = 'mutated';
  assert.equal(((encoded.report?.trace as { events: Array<{ path: string }> }).events[0]!).path, 'window.navigator');
});

test('encodeResult accepts a diagnostic report created in another Realm', () => {
  const report = runInNewContext('({ trace: { events: [{ op: "call" }] }, count: 1 })') as Record<string, never>;
  const encoded = encodeResult({ ok: true, report, plan, support });

  assert.deepEqual(encoded, {
    ok: true,
    report: { trace: { events: [{ op: 'call' }] }, count: 1 },
    plan,
    support,
  });
});

test('encodeResult rejects unsafe reports without invoking accessors', () => {
  let reads = 0;
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, 'secret', {
    enumerable: true,
    get() { reads++; return 'leak'; },
  });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const expected = {
    ok: false,
    error: {
      name: 'MimicError', phase: 'encode', code: 'ENCODE_FAILED',
      message: 'Result 无法编码为 JSON', plan,
    },
    plan,
    support,
  };

  for (const report of [accessor, cycle]) {
    assert.deepEqual(encodeResult({ ok: true, report, plan, support } as Result<unknown>), expected);
  }
  assert.equal(reads, 0);
});

test('encodeResult retains an independently safe report when value encoding fails', () => {
  const report = { trace: { calls: ['window.fetch'] } };
  const encoded = encodeResult({ ok: true, value: 1n, report, plan, support });

  assert.deepEqual(encoded, {
    ok: false,
    error: {
      name: 'MimicError', phase: 'encode', code: 'ENCODE_FAILED',
      message: 'Result 无法编码为 JSON', plan,
    },
    report,
    plan,
    support,
  });
  assert.notEqual(encoded.report, report);
  assert.equal(Object.isFrozen(encoded.report?.trace), true);
});

test('Result codec preserves the synthetic marker through encode failure', () => {
  const input = { ok: true, value: 1n, plan, support, synthetic: true } as unknown as Result<unknown>;

  assert.deepEqual(encodeResult(input), {
    ok: false,
    error: {
      name: 'MimicError', phase: 'encode', code: 'ENCODE_FAILED',
      message: 'Result 无法编码为 JSON', plan,
    },
    plan,
    support,
    synthetic: true,
  });
  assert.deepEqual(parseResult({ ok: true, plan, support, synthetic: true }), {
    ok: true, plan, support, synthetic: true,
  });
  assert.throws(
    () => parseResult({ ok: true, plan, support, synthetic: false }),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_RESULT',
  );

  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const failed = {
    ok: false,
    error: { name: 'MimicError', phase: 'run', code: 'RUN_FAILED', message: 'failed' },
    report: cycle,
    synthetic: true,
  } as unknown as Result<unknown>;
  assert.deepEqual(encodeResult(failed), {
    ok: false,
    error: { name: 'MimicError', phase: 'encode', code: 'ENCODE_FAILED', message: 'Result 无法编码为 JSON' },
    synthetic: true,
  });
});

test('encodeResult does not read proxied array properties through get traps', () => {
  let reads = 0;
  const value = new Proxy([1, 2], {
    get(target, key, receiver) {
      reads++;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });

  assert.deepEqual(encodeResult({ ok: true, value, plan, support }), {
    ok: true,
    value: [1, 2],
    plan,
    support,
  });
  assert.equal(reads, 0);
});

test('encodeResult rejects accessors without invoking them', () => {
  let reads = 0;
  const input: Record<string, unknown> = { ok: true, plan, support };
  Object.defineProperty(input, 'value', {
    enumerable: true,
    get() {
      reads++;
      return { answer: 42 };
    },
  });

  const encoded = encodeResult(input as Result<unknown>);

  assert.equal(reads, 0);
  assert.deepEqual(encoded, {
    ok: false,
    error: {
      name: 'MimicError',
      phase: 'encode',
      code: 'ENCODE_FAILED',
      message: 'Result 无法编码为 JSON',
      plan,
    },
    plan,
    support,
  });
});

test('encodeResult turns unsafe values into one stable encode failure', () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let getterReads = 0;
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, 'secret', {
    enumerable: true,
    get() {
      getterReads++;
      return 'leak';
    },
  });
  const trapped = new Proxy({}, {
    getPrototypeOf() {
      throw new RangeError('host trap text must not leak');
    },
  });
  const values: unknown[] = [1n, () => 1, Symbol('value'), cycle, -0, Number.NaN, Number.POSITIVE_INFINITY, accessor, trapped];
  const expected = {
    ok: false,
    error: {
      name: 'MimicError',
      phase: 'encode',
      code: 'ENCODE_FAILED',
      message: 'Result 无法编码为 JSON',
      plan,
    },
    plan,
    support,
  };

  for (const value of values) {
    assert.deepEqual(encodeResult({ ok: true, value, plan, support }), expected);
  }
  assert.equal(getterReads, 0);
});

test('Result codec validates and clones an existing failure wire', () => {
  const details = { line: 7 };
  const report = { trace: { calls: ['window.fetch'] } };
  const input = {
    ok: false as const,
    error: {
      name: 'MimicError' as const,
      phase: 'run' as const,
      code: 'RUN_FAILED' as const,
      message: 'execution failed',
      details,
      plan,
    },
    plan,
    support,
    report,
  };

  const encoded = encodeResult(input);

  assert.deepEqual(encoded, input);
  assert.equal(encoded.ok, false);
  if (encoded.ok) assert.fail('expected a failure Result');
  assert.notEqual(encoded.error.details, details);
  assert.notEqual(encoded.report, report);
  assert.notEqual(encoded.report?.trace, report.trace);
  assert.equal(Object.isFrozen(encoded), true);
  assert.equal(Object.isFrozen(encoded.error), true);
  assert.equal(Object.isFrozen(encoded.report?.trace), true);
});

test('parseResult rejects invalid and incoherent wire values as BAD_RESULT', () => {
  const cases = [
    { ok: true, value: 1, plan: 'not-a-hash', support },
    { ok: true, value: undefined, plan, support },
    {
      ok: false,
      error: {
        name: 'MimicError', phase: 'run', code: 'RUN_FAILED', message: 'failed', plan: 'b'.repeat(64),
      },
      plan,
    },
  ];

  for (const input of cases) {
    assert.throws(
      () => parseResult(input),
      (error: unknown) => error instanceof MimicError && error.phase === 'parse' && error.code === 'BAD_RESULT',
    );
  }
});
