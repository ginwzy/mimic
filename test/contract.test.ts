import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv } from 'ajv';
import dataSchema from '../schemas/v2/data.schema.json' with { type: 'json' };
import irSchema from '../schemas/v2/ir.schema.json' with { type: 'json' };
import planSchema from '../schemas/v2/plan.schema.json' with { type: 'json' };
import resultSchema from '../schemas/v2/result.schema.json' with { type: 'json' };
import {
  MimicError,
  parseJob,
  parsePage,
  parseProfile,
  parseShape,
  seal,
  type ErrorCode,
} from '../src/index.js';

const schemaAjv = new Ajv({ allErrors: true, strict: true });
schemaAjv.addSchema(dataSchema);
schemaAjv.addSchema(irSchema);
const validatePlanSchema = schemaAjv.compile(planSchema);
const validateResultSchema = schemaAjv.compile(resultSchema);

const hash = 'a'.repeat(64);

const planWire = {
  schema: 2,
  id: hash,
  profile: { id: 'profile', hash },
  shape: { id: 'chromium/chrome/linux/desktop/140', hash, level: 'derived' },
  boot: { url: 'https://example.com/', html: '<!doctype html>', cookies: ['a=1'] },
  task: 'probe',
  engine: { id: 'jsdom', hash: 'jsdom-fixture' },
  catalog: { id: 'default', hash },
  features: ['surface'],
  operations: [
    { op: 'alloc', id: 'box', kind: 'object', feature: 'surface' },
    { op: 'alloc', id: 'events', kind: 'event', feature: 'surface' },
    {
      op: 'alloc', id: 'clean', kind: 'proxy', source: { path: 'window.navigator' },
      symbols: ['impl'], feature: 'surface',
    },
    {
      op: 'alloc', id: 'call.fn', kind: 'function', slot: 'call', prototype: { path: 'window.Function.prototype' },
      shape: {
        name: 'call', length: 1, native: true, constructable: true,
        hasPrototype: true, keys: ['length', 'name', 'prototype'],
      },
      feature: 'surface',
    },
    { op: 'proto', target: { node: 'box' }, value: { path: 'window.Object.prototype' }, feature: 'surface' },
    {
      op: 'prop', target: { node: 'box' }, key: 'answer', feature: 'surface',
      desc: {
        kind: 'data', value: { json: { nested: [42, null] } },
        writable: true, enumerable: true, configurable: true,
      },
    },
    {
      op: 'prop', target: { node: 'box' }, key: { symbol: 'toStringTag' }, feature: 'surface',
      desc: {
        kind: 'accessor', get: { node: 'call.fn' }, set: { node: 'call.fn' },
        enumerable: false, configurable: true,
      },
    },
    { op: 'drop', target: { path: 'window' }, key: { symbol: 'for:mimic' }, feature: 'surface' },
    {
      op: 'fn', target: { node: 'call.fn' }, feature: 'surface',
      shape: {
        name: 'call', length: 1, native: true, constructable: true,
        hasPrototype: true, keys: ['length', 'name', 'prototype'],
      },
    },
    {
      op: 'fn', target: { path: 'window.Node.prototype' }, key: 'nodeType', part: 'get', feature: 'surface',
      shape: {
        name: 'get nodeType', length: 0, native: true, constructable: false,
        hasPrototype: false, keys: ['length', 'name'],
      },
    },
    { op: 'order', target: { node: 'box' }, keys: ['answer', { symbol: 'toStringTag' }], feature: 'surface' },
  ],
  binds: [{
    slot: 'call', driver: 'surface', config: { mode: 'strict' }, feature: 'surface',
    sources: ['window.alert', 'window.Object.prototype'],
  }],
  support: { structure: 'derived', 'surface.api': 'emulated' },
};

const errorCodes: Record<ErrorCode, true> = {
  BAD_JOB: true,
  BAD_PROFILE: true,
  BAD_PAGE: true,
  BAD_SHAPE: true,
  BAD_PLAN: true,
  BAD_RESULT: true,
  BAD_COLLECT: true,
  FEATURE_CYCLE: true,
  DUPLICATE_FEATURE: true,
  NO_FEATURE: true,
  WRITE_CONFLICT: true,
  NO_DRIVER: true,
  LOW_SUPPORT: true,
  SYNTHETIC_REQUIRED: true,
  ENGINE_BLOCKED: true,
  INSTALL_FAILED: true,
  RUN_FAILED: true,
  ENCODE_FAILED: true,
  LEGACY_PATH: true,
  LEGACY_PARENT: true,
  LEGACY_CYCLE: true,
  LEGACY_NAME: true,
  LEGACY_TRAITS: true,
  LEGACY_ENGINE: true,
};

const source = {
  kind: 'capture' as const,
  hash: 'a'.repeat(64),
  file: 'profiles/device.json',
};

const shape = parseShape(seal({
  schema: 2 as const,
  id: 'chromium/chrome/android/mobile/140',
  target: {
    engine: 'chromium' as const,
    host: 'chrome' as const,
    platform: 'android' as const,
    form: 'mobile' as const,
    version: 140,
  },
  level: 'derived' as const,
  source: { kind: 'manual' as const, hash: source.hash, file: 'shapes/android-140.json' },
  features: [],
  ops: [],
  support: { structure: 'derived' as const },
}));

const methodShape = {
  name: 'call', length: 1, native: true, constructable: false,
  hasPrototype: false, keys: ['length', 'name'],
};

const completeShapeOps = [
  { op: 'alloc', id: 'box', kind: 'object' },
  { op: 'alloc', id: 'events', kind: 'event' },
  {
    op: 'alloc', id: 'plugins', kind: 'proxy',
    source: { path: 'window.navigator.plugins' }, symbols: ['impl'],
  },
  {
    op: 'alloc', id: 'call.fn', kind: 'function', slot: 'call',
    prototype: { path: 'window.Function.prototype' },
    shape: {
      name: 'call', length: 1, native: true, constructable: true,
      hasPrototype: true, keys: ['length', 'name', 'prototype'],
    },
  },
  { op: 'proto', target: { node: 'box' }, value: { path: 'window.Object.prototype' } },
  {
    op: 'prop', target: { node: 'box' }, key: 'answer',
    desc: {
      kind: 'data', value: { json: { nested: [42, null] } },
      writable: true, enumerable: true, configurable: true,
    },
  },
  {
    op: 'prop', target: { node: 'box' }, key: { symbol: 'toStringTag' },
    desc: {
      kind: 'accessor', get: { node: 'call.fn' },
      enumerable: false, configurable: true,
    },
  },
  { op: 'drop', target: { path: 'window' }, key: { symbol: 'for:mimic' } },
  { op: 'fn', target: { node: 'call.fn' }, shape: methodShape },
  { op: 'fn', target: { path: 'window' }, key: 'alert', part: 'value', shape: methodShape },
  { op: 'order', target: { node: 'box' }, keys: ['answer', { symbol: 'toStringTag' }] },
];

function shapeWithOps(ops: unknown[]) {
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({ ...body, ops }));
}

const evidence = Object.fromEntries(
  ['navigator', 'screen', 'window', 'timezone', 'webgl', 'canvas', 'audio', 'fonts']
    .map((part) => [part, { support: 'derived', fields: {}, source }]),
);

test('parseJob accepts a run job through the public contract', () => {
  const job = parseJob({
    kind: 'run',
    code: '1 + 1',
    scriptUrl: 'https://example.com/app.js',
    trace: true,
  });

  assert.deepEqual(job, {
    kind: 'run',
    code: '1 + 1',
    scriptUrl: 'https://example.com/app.js',
    trace: true,
  });
});

test('parseJob rejects invalid input with a stable parse error', () => {
  assert.throws(
    () => parseJob({ kind: 'run', timeout: -1 }),
    (error: unknown) => {
      assert.ok(error instanceof MimicError);
      assert.equal(error.phase, 'parse');
      assert.equal(error.code, 'BAD_JOB');
      assert.ok(Array.isArray(error.details));
      return true;
    },
  );
});

test('parseShape accepts a normalized browser selector', () => {
  assert.deepEqual(parseShape(shape), shape);
});

test('parseShape rejects an invalid browser version', () => {
  const { hash: _hash, ...body } = shape;
  assert.throws(
    () => parseShape(seal({ ...body, target: { ...body.target, version: 0 } })),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_SHAPE',
  );
});

test('parseShape rejects contradictory selector fields', () => {
  const { hash: _hash, ...body } = shape;
  assert.throws(
    () => parseShape(seal({ ...body, target: { ...body.target, host: 'webview' as const } })),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_SHAPE',
  );
});

test('parseShape accepts the complete DraftOp contract', () => {
  const parsed = shapeWithOps(completeShapeOps);
  assert.deepEqual(parsed.ops, completeShapeOps);
});

test('parseShape requires fn key and part together', () => {
  assert.throws(
    () => shapeWithOps([{ op: 'fn', target: { path: 'window' }, key: 'alert', shape: methodShape }]),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_SHAPE',
  );
});

test('parseShape rejects proxy allocations without symbol descriptions', () => {
  assert.throws(
    () => shapeWithOps([{
      op: 'alloc', id: 'proxy', kind: 'proxy', source: { path: 'window.navigator.plugins' }, symbols: [],
    }]),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_SHAPE',
  );
});

test('parseProfile accepts device identity without page state', () => {
  const body = {
    schema: 2 as const,
    id: 'android/device-v140',
    target: shape.target,
    shape: { id: shape.id, hash: shape.hash },
    source,
    navigator: {
      userAgent: 'Chrome/140', appVersion: 'Chrome/140', platform: 'Linux armv8l', vendor: 'Google Inc.',
      language: 'en-US', languages: ['en-US'], hardwareConcurrency: 8, deviceMemory: 8,
      maxTouchPoints: 5, cookieEnabled: true,
      userAgentData: {
        brands: [{ brand: 'Chromium', version: '140' }], mobile: true, platform: 'Android',
        architecture: '', bitness: '', fullVersionList: [], model: '', platformVersion: '',
        uaFullVersion: '140.0.0.0', wow64: false,
      },
    },
    screen: {
      width: 360, height: 780, availWidth: 360, availHeight: 780, availLeft: 0, availTop: 0,
      colorDepth: 24, pixelDepth: 24, orientation: { type: 'portrait-primary', angle: 0 },
    },
    window: { innerWidth: 360, innerHeight: 649, outerWidth: 360, outerHeight: 780, devicePixelRatio: 3 },
    timezone: { timeZone: 'Europe/Rome', offset: -120 },
    webgl: { parameters: { '3379': 8192 }, extensions: [], unmaskedVendor: '', unmaskedRenderer: '' },
    evidence,
  };
  const profile = seal(body);

  assert.deepEqual(parseProfile(profile), profile);
  const parsed = parseProfile(profile);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.navigator));
  const { target: _target, ...withoutTarget } = body;
  assert.throws(
    () => parseProfile(seal(withoutTarget)),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_PROFILE',
  );
  body.navigator.userAgent = 'mutated';
  assert.equal(parsed.navigator.userAgent, 'Chrome/140');
});

test('parseProfile rejects a default Shape ref that contradicts its device target', () => {
  const body = {
    schema: 2 as const,
    id: 'android/device-v140',
    target: shape.target,
    shape: { id: 'chromium/chrome/linux/desktop/140', hash: shape.hash },
    source,
    navigator: {
      userAgent: 'Chrome/140', appVersion: 'Chrome/140', platform: 'Linux armv8l', vendor: 'Google Inc.',
      language: 'en-US', languages: ['en-US'], hardwareConcurrency: 8, deviceMemory: 8,
      maxTouchPoints: 5, cookieEnabled: true,
      userAgentData: {
        brands: [{ brand: 'Chromium', version: '140' }], mobile: true, platform: 'Android',
        architecture: '', bitness: '', fullVersionList: [], model: '', platformVersion: '',
        uaFullVersion: '140.0.0.0', wow64: false,
      },
    },
    screen: {
      width: 360, height: 780, availWidth: 360, availHeight: 780, availLeft: 0, availTop: 0,
      colorDepth: 24, pixelDepth: 24, orientation: { type: 'portrait-primary', angle: 0 },
    },
    evidence,
  };

  assert.throws(
    () => parseProfile(seal(body)),
    (error: unknown) => error instanceof MimicError && error.phase === 'parse' && error.code === 'BAD_PROFILE',
  );
});

test('parseProfile rejects identity without screen evidence', () => {
  assert.throws(
    () => parseProfile({ schema: 2, id: 'broken', shape, source, navigator: {} }),
    (error: unknown) => error instanceof MimicError && error.phase === 'parse' && error.code === 'BAD_PROFILE',
  );
});

test('parseProfile rejects values that cannot cross a worker boundary', () => {
  assert.throws(
    () => parseProfile({
      schema: 2,
      id: 'broken',
      shape,
      source,
      navigator: { userAgent: () => 'not-json' },
      screen: {},
    }),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_PROFILE',
  );
});

test('parsePage accepts execution state separately from Profile', () => {
  const page = seal({
    schema: 2 as const,
    id: 'android/device-v140:default',
    source,
    url: 'https://example.com/',
    cookies: ['a=1; Path=/'],
    connection: { effectiveType: '4g', downlink: 10, rtt: 0, saveData: false },
    clock: { now: 1735689600000, seed: 305419896 },
    performance: {
      resources: [{
        name: 'https://example.com/app.js',
        initiatorType: 'script',
        startTime: 1,
        duration: 2,
        nextHopProtocol: 'h2',
        transferSize: 123,
        encodedBodySize: 100,
        decodedBodySize: 200,
        responseStatus: 200,
      }],
    },
  });

  assert.deepEqual(parsePage(page), page);
});

test('parsePage rejects incomplete or impossible Performance resource evidence', () => {
  const badPage = (resource: object) => seal({
    schema: 2 as const,
    id: 'bad:performance',
    source,
    performance: { resources: [resource] },
  });
  assert.throws(
    () => parsePage(badPage({ name: 'https://example.com/app.js' })),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_PAGE',
  );
  assert.throws(
    () => parsePage(badPage({
      name: 'https://example.com/app.js',
      initiatorType: 'script',
      startTime: -1,
      duration: 0,
      nextHopProtocol: 'h2',
      transferSize: 0,
      encodedBodySize: 0,
      decodedBodySize: 0,
      responseStatus: 200,
    })),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_PAGE',
  );
});

test('parsePage rejects non-http document URLs', () => {
  const badPage = (url: string) => seal({ schema: 2 as const, id: 'bad:page', source, url });
  assert.throws(
    () => parsePage(badPage('file:///tmp/page.html')),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_PAGE',
  );
  assert.throws(
    () => parsePage(badPage('http://')),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_PAGE',
  );
});

test('parseJob rejects a syntactically invalid script URL', () => {
  assert.throws(
    () => parseJob({ kind: 'run', code: '1', scriptUrl: 'https://' }),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_JOB',
  );
});

test('MimicError serializes a stable cross-process error contract', () => {
  const error = new MimicError({
    phase: 'compile',
    code: 'NO_DRIVER',
    message: 'driver missing',
    plan: 'plan-123',
  });

  assert.deepEqual(error.toJSON(), {
    name: 'MimicError',
    phase: 'compile',
    code: 'NO_DRIVER',
    message: 'driver missing',
    plan: 'plan-123',
  });
});

test('Plan Schema accepts the complete serialized IR contract', () => {
  assert.equal(validatePlanSchema(planWire), true, JSON.stringify(validatePlanSchema.errors));
  assert.equal(validatePlanSchema({ ...planWire, synthetic: true }), true, JSON.stringify(validatePlanSchema.errors));
});

test('Plan Schema rejects fields and values outside the compiler contract', () => {
  const cases = [
    { ...planWire, extra: true },
    { ...planWire, task: 'unknown' },
    { ...planWire, synthetic: false },
    { ...planWire, synthetic: 'yes' },
    { ...planWire, support: { structure: 'synthetic' } },
    { ...planWire, support: { BadName: 'derived' } },
    { ...planWire, operations: [{ op: 'unknown', feature: 'surface' }] },
    {
      ...planWire,
      operations: [{
        op: 'alloc', id: 'bad.fn', kind: 'function', feature: 'surface',
        shape: { name: 'bad', length: -1, native: true, constructable: false, hasPrototype: false, keys: [] },
      }],
    },
    {
      ...planWire,
      operations: [{
        op: 'alloc', id: 'bad.proxy', kind: 'proxy', source: { path: 'window.navigator' },
        symbols: [], feature: 'surface',
      }],
    },
    { ...planWire, binds: [{ slot: 'call', driver: 'surface', feature: 'surface', sources: ['document.body'] }] },
    { ...planWire, binds: [{ slot: 'call', driver: 'surface', feature: 'surface', sources: [] }] },
    {
      ...planWire,
      operations: [{
        op: 'fn', target: { path: 'window' }, key: 'atob', feature: 'surface',
        shape: { name: 'atob', length: 1, native: true, constructable: false, hasPrototype: false, keys: ['length', 'name'] },
      }],
    },
  ];

  for (const value of cases) assert.equal(validatePlanSchema(value), false);
});

test('Result Schema preserves success, undefined, report, and failure wire forms', () => {
  const success = {
    ok: true, value: { answer: 42 }, report: { trace: { calls: ['window.fetch'] } },
    plan: hash, support: { structure: 'derived' },
  };
  const undefinedSuccess = { ok: true, plan: hash, support: {} };
  const failure = {
    ok: false,
    error: {
      name: 'MimicError', phase: 'run', code: 'RUN_FAILED', message: 'execution failed',
      details: { line: 1 }, plan: hash,
    },
    plan: hash,
    support: { structure: 'derived' },
    report: { trace: { calls: ['window.fetch'] } },
  };

  assert.equal(validateResultSchema(success), true, JSON.stringify(validateResultSchema.errors));
  assert.equal(validateResultSchema(undefinedSuccess), true, JSON.stringify(validateResultSchema.errors));
  assert.equal(validateResultSchema(failure), true, JSON.stringify(validateResultSchema.errors));
  assert.equal(validateResultSchema({ ...success, synthetic: true }), true, JSON.stringify(validateResultSchema.errors));
  assert.equal(validateResultSchema({ ...failure, synthetic: true }), true, JSON.stringify(validateResultSchema.errors));
  for (const code of Object.keys(errorCodes)) {
    assert.equal(validateResultSchema({ ok: false, error: { name: 'MimicError', phase: 'parse', code, message: '' } }), true);
  }
});

test('Result Schema rejects ambiguous or non-JSON protocol values', () => {
  const cases = [
    { ok: true, value: 1, plan: hash },
    { ok: true, value: 1, plan: hash, support: {}, error: {} },
    { ok: true, value: 1, plan: hash, support: {}, synthetic: false },
    { ok: false, error: { name: 'MimicError', phase: 'run', code: 'RUN_FAILED', message: 'failed' }, synthetic: false },
    { ok: false, error: { name: 'Error', phase: 'run', code: 'RUN_FAILED', message: 'failed' } },
    { ok: false, error: { name: 'MimicError', phase: 'unknown', code: 'RUN_FAILED', message: 'failed' } },
    { ok: false, error: { name: 'MimicError', phase: 'run', code: 'UNKNOWN', message: 'failed' } },
    { ok: false, error: { name: 'MimicError', phase: 'run', code: 'RUN_FAILED', message: 'failed', extra: true } },
    { ok: true, plan: hash, support: {}, report: [] },
    { ok: false, error: { name: 'MimicError', phase: 'run', code: 'RUN_FAILED', message: 'failed' }, report: 'trace' },
  ];

  for (const value of cases) assert.equal(validateResultSchema(value), false);
});
