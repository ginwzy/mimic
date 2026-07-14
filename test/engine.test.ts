import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  Catalog,
  compile,
  JsdomEngine,
  LegacyProfiles,
  MimicError,
  parseJob,
  parseProfile,
  parseShape,
  seal,
  type Driver,
  type Feature,
  type Profile,
  type Shape,
} from '../src/index.js';
import { JSDOM_ENGINE_ABI } from '../src/engines/jsdom.js';

const store = new LegacyProfiles(path.resolve('profiles'));

test('JsdomEngine locks the current ABI', () => {
  assert.equal(JSDOM_ENGINE_ABI, 'mimic-jsdom-v2.7');
});

function shapeFor(shape: Shape, features: readonly Feature[]): Shape {
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...features.map((feature) => feature.id)].sort(),
    ops: [],
    support: { structure: shape.support.structure || shape.level },
  }));
}

function select(profile: Profile, shape: Shape, features: readonly Feature[]): { profile: Profile; catalog: Catalog } {
  const nextShape = shapeFor(shape, features);
  const { hash: _hash, ...body } = profile;
  return {
    profile: parseProfile(seal({ ...body, shape: { id: nextShape.id, hash: nextShape.hash } })),
    catalog: Catalog.create('test', [nextShape], features),
  };
}

const surface: Feature = {
  id: 'surface',
  build: () => ({
    operations: [
      { op: 'alloc', id: 'box', kind: 'object' },
      {
        op: 'alloc', id: 'answer.fn', kind: 'function', slot: 'answer',
        shape: {
          name: 'v2answer', length: 0, native: true, constructable: false,
          hasPrototype: false, keys: ['length', 'name'],
        },
      },
      { op: 'proto', target: { node: 'box' }, value: { path: 'window.Object.prototype' } },
      {
        op: 'prop', target: { node: 'box' }, key: 'z',
        desc: { kind: 'data', value: { json: 1 }, writable: true, enumerable: true, configurable: true },
      },
      {
        op: 'prop', target: { node: 'box' }, key: 'a',
        desc: { kind: 'data', value: { json: 2 }, writable: true, enumerable: true, configurable: true },
      },
      {
        op: 'prop', target: { path: 'window' }, key: 'v2box',
        desc: { kind: 'data', value: { ref: { node: 'box' } }, writable: true, enumerable: true, configurable: true },
      },
      {
        op: 'prop', target: { path: 'window' }, key: 'v2answer',
        desc: { kind: 'data', value: { ref: { node: 'answer.fn' } }, writable: true, enumerable: true, configurable: true },
      },
      { op: 'drop', target: { path: 'window' }, key: 'name' },
      { op: 'order', target: { node: 'box' }, keys: ['a', 'z'] },
    ],
    binds: [{ slot: 'answer', driver: 'answer' }],
    support: { oracle: 'emulated' },
  }),
};

const answer: Driver = {
  open: () => ({ call: () => 42 }),
};

test('JsdomEngine atomically installs a compiled Plan and executes it', async () => {
  const imported = await store.load('chrome-mac');
  const engine = new JsdomEngine();
  const plan = compile({
    ...select(imported.profile, imported.shape, [surface]),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'run', code: 'v2answer()' }),
    engine: engine.manifest,
    drivers: ['answer'],
  });

  const runtime = engine.open(plan, { answer });
  try {
    const result = runtime.run(`JSON.stringify({
      answer: v2answer(),
      native: v2answer.toString(),
      name: v2answer.name,
      length: v2answer.length,
      prototype: Object.prototype.hasOwnProperty.call(v2answer, 'prototype'),
      keys: Object.keys(v2box),
      proto: Object.getPrototypeOf(v2box) === Object.prototype,
      dropped: Object.prototype.hasOwnProperty.call(window, 'name')
    })`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      answer: 42,
      native: 'function v2answer() { [native code] }',
      name: 'v2answer',
      length: 0,
      prototype: false,
      keys: ['a', 'z'],
      proto: true,
      dropped: false,
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('JsdomEngine rejects an impossible Plan without exposing a partial Runtime', async () => {
  const imported = await store.load('chrome-mac');
  const engine = new JsdomEngine();
  const impossible: Feature = {
    id: 'impossible',
    build: () => ({ operations: [{ op: 'drop', target: { path: 'window' }, key: 'location' }] }),
  };
  const plan = compile({
    ...select(imported.profile, imported.shape, [impossible]),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: [],
  });

  assert.throws(
    () => engine.open(plan),
    (error: unknown) => error instanceof MimicError && error.phase === 'install' && error.code === 'ENGINE_BLOCKED',
  );
  assert.equal(engine.active, 0);
});

test('JsdomEngine uses a trusted close even when Plan replaces window.close', async () => {
  const imported = await store.load('chrome-mac');
  const replaceClose: Feature = {
    id: 'replace-close',
    build: () => ({ operations: [{
      op: 'prop', target: { path: 'window' }, key: 'close',
      desc: { kind: 'data', value: { json: null }, writable: true, enumerable: true, configurable: true },
    }] }),
  };
  const failAfterClose: Feature = {
    id: 'fail-after-close',
    requires: ['replace-close'],
    build: () => ({ operations: [{ op: 'order', target: { path: 'window' }, keys: [] }] }),
  };
  const engine = new JsdomEngine();
  const input = {
    profile: imported.profile,
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: [],
  };

  const runtime = engine.open(compile({
    ...input,
    ...select(imported.profile, imported.shape, [replaceClose]),
  }));
  assert.equal(runtime.run('close === null').ok, true);
  assert.doesNotThrow(() => runtime.dispose());
  assert.equal(engine.active, 0);

  assert.throws(
    () => engine.open(compile({
      ...input,
      ...select(imported.profile, imported.shape, [replaceClose, failAfterClose]),
    })),
    (error: unknown) => error instanceof MimicError && error.code === 'ENGINE_BLOCKED',
  );
  assert.equal(engine.active, 0);
});

test('JsdomEngine repairs existing function Realm identity', async () => {
  const imported = await store.load('chrome-mac');
  const engine = new JsdomEngine();
  const feature: Feature = {
    id: 'realm-fn',
    build: () => ({ operations: [{
      op: 'fn', target: { path: 'window.alert' },
      shape: {
        name: 'alert', length: 0, native: true, constructable: true,
        hasPrototype: true, keys: ['length', 'name', 'prototype'],
      },
    }] }),
  };
  const plan = compile({
    ...select(imported.profile, imported.shape, [feature]),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: [],
  });
  const runtime = engine.open(plan);
  try {
    const result = runtime.run(`JSON.stringify({
      instance: alert instanceof Function,
      proto: Object.getPrototypeOf(alert) === Function.prototype,
      native: Function.prototype.toString.call(alert)
    })`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      instance: true,
      proto: true,
      native: 'function alert() { [native code] }',
    });
  } finally {
    runtime.dispose();
  }
});

test('JsdomEngine shapes property values and accessors without losing behavior', async () => {
  const imported = await store.load('chrome-mac');
  const engine = new JsdomEngine();
  const feature: Feature = {
    id: 'property-fn',
    build: () => ({ operations: [
      {
        op: 'fn', target: { path: 'window' }, key: 'atob', part: 'value',
        shape: {
          name: 'atob', length: 1, native: true, constructable: false,
          hasPrototype: false, keys: ['length', 'name'],
        },
      },
      {
        op: 'fn', target: { path: 'window.EventTarget.prototype' }, key: 'addEventListener', part: 'value',
        shape: {
          name: 'addEventListener', length: 2, native: true, constructable: false,
          hasPrototype: false, keys: ['length', 'name'],
        },
      },
      {
        op: 'fn', target: { path: 'window.Node.prototype' }, key: 'nodeType', part: 'get',
        shape: {
          name: 'get nodeType', length: 0, native: true, constructable: false,
          hasPrototype: false, keys: ['length', 'name'],
        },
      },
    ] }),
  };
  const plan = compile({
    ...select(imported.profile, imported.shape, [feature]),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: [],
  });
  const runtime = engine.open(plan);
  try {
    const result = runtime.run(`(() => {
      const get = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeType').get;
      const target = new EventTarget();
      let calls = 0;
      target.addEventListener('ready', () => calls++);
      target.dispatchEvent(new Event('ready'));
      return JSON.stringify({
        atob: [atob('b2s='), atob.name, atob.length, atob.toString(), Object.hasOwn(atob, 'prototype')],
        event: [calls, target.addEventListener.name, target.addEventListener.length, target.addEventListener.toString()],
        getter: [document.nodeType, get.name, get.length, get.toString(), Object.hasOwn(get, 'prototype')],
      });
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      atob: ['ok', 'atob', 1, 'function atob() { [native code] }', false],
      event: [1, 'addEventListener', 2, 'function addEventListener() { [native code] }'],
      getter: [9, 'get nodeType', 0, 'function get nodeType() { [native code] }', false],
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('JsdomEngine honors boot exactly and reports Realm errors without host fallback', async () => {
  const imported = await store.load('chrome-mac');
  assert.ok(imported.page);
  const { hash: _hash, ...pageBody } = imported.page;
  const page = seal({ ...pageBody, html: '', cookies: ['boot=ready; Path=/'] });
  const engine = new JsdomEngine();
  const plan = compile({
    ...select(imported.profile, imported.shape, []),
    page,
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: [],
  });
  assert.equal(plan.boot.html, '');
  const runtime = engine.open(plan);
  try {
    const result = runtime.run(`JSON.stringify({
      hidden: document.hidden,
      state: document.visibilityState,
      raf: typeof requestAnimationFrame,
      cookie: document.cookie
    })`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      hidden: false,
      state: 'visible',
      raf: 'function',
      cookie: 'boot=ready',
    });
    const failed = runtime.run('throw new Error("realm boom")');
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.error, 'realm boom');
  } finally {
    runtime.dispose();
  }
});

test('JsdomEngine keeps Driver values and constructed instances in the target Realm', async () => {
  const imported = await store.load('chrome-mac');
  const engine = new JsdomEngine();
  const feature: Feature = {
    id: 'driver-realm',
    build: () => ({
      operations: [
        {
          op: 'alloc', id: 'value.fn', kind: 'function', slot: 'value',
          shape: { name: 'value', length: 0, native: true, constructable: false, hasPrototype: false, keys: ['length', 'name'] },
        },
        {
          op: 'alloc', id: 'ctor.fn', kind: 'function', slot: 'ctor',
          shape: { name: 'Ctor', length: 0, native: true, constructable: true, hasPrototype: true, keys: ['length', 'name', 'prototype'] },
        },
        {
          op: 'prop', target: { path: 'window' }, key: 'value',
          desc: { kind: 'data', value: { ref: { node: 'value.fn' } }, writable: true, enumerable: true, configurable: true },
        },
        {
          op: 'prop', target: { path: 'window' }, key: 'Ctor',
          desc: { kind: 'data', value: { ref: { node: 'ctor.fn' } }, writable: true, enumerable: true, configurable: true },
        },
      ],
      binds: [{ slot: 'value', driver: 'value' }, { slot: 'ctor', driver: 'ctor' }],
    }),
  };
  const value: Driver = { open: (port) => ({ call: () => port.clone({ ready: true }) }) };
  const ctor: Driver = { open: () => ({ construct: () => undefined }) };
  const plan = compile({
    ...select(imported.profile, imported.shape, [feature]),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: ['value', 'ctor'],
  });
  const runtime = engine.open(plan, { value, ctor });
  try {
    const result = runtime.run('class Child extends Ctor {}; JSON.stringify({ value: value() instanceof Object, child: new Child() instanceof Child })');
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), { value: true, child: true });
  } finally {
    runtime.dispose();
  }
});

test('JsdomEngine creates dynamic Realm objects only from allocated prototype nodes', async () => {
  const imported = await store.load('chrome-mac');
  const engine = new JsdomEngine();
  const feature: Feature = {
    id: 'make',
    build: () => ({
      operations: [
        { op: 'alloc', id: 'make.proto', kind: 'object' },
        {
          op: 'alloc', id: 'make.fn', kind: 'function', slot: 'make',
          shape: {
            name: 'make', length: 0, native: true, constructable: false,
            hasPrototype: false, keys: ['length', 'name'],
          },
        },
        {
          op: 'prop', target: { path: 'window' }, key: 'make',
          desc: {
            kind: 'data', value: { ref: { node: 'make.fn' } },
            writable: true, enumerable: true, configurable: true,
          },
        },
      ],
      binds: [{ slot: 'make', driver: 'make' }],
    }),
  };
  const plan = compile({
    ...select(imported.profile, imported.shape, [feature]),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: ['make'],
  });
  const make: Driver = { open: (port) => ({ call: () => port.make('make.proto') }) };
  const runtime = engine.open(plan, { make });
  try {
    const result = runtime.run(`(() => {
      const value = make();
      return JSON.stringify({ realm: value instanceof Object, proto: Object.getPrototypeOf(value) === Object.getPrototypeOf(make()) });
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), { realm: true, proto: true });
  } finally {
    runtime.dispose();
  }

  const unknown: Driver = { open: (port) => { port.make('missing'); return {}; } };
  assert.throws(
    () => engine.open(plan, { make: unknown }),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_PLAN' && /unknown proto node|\u672a\u77e5 proto node/.test(error.message),
  );
  const invalid: Driver = { open: (port) => { port.make(null as never); return {}; } };
  assert.throws(
    () => engine.open(plan, { make: invalid }),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_PLAN',
  );
  assert.equal(engine.active, 0);
});

test('JsdomEngine scopes source capabilities to each Driver', async () => {
  const imported = await store.load('chrome-mac');
  const engine = new JsdomEngine();
  const feature: Feature = {
    id: 'sources',
    build: () => ({
      operations: [
        {
          op: 'alloc', id: 'source.a', kind: 'function', slot: 'source.a',
          shape: { name: 'a', length: 0, native: true, constructable: false, hasPrototype: false, keys: ['length', 'name'] },
        },
        {
          op: 'alloc', id: 'source.b', kind: 'function', slot: 'source.b',
          shape: { name: 'b', length: 0, native: true, constructable: false, hasPrototype: false, keys: ['length', 'name'] },
        },
      ],
      binds: [
        { slot: 'source.a', driver: 'a', sources: ['window.atob'] },
        { slot: 'source.b', driver: 'b' },
      ],
    }),
  };
  const selected = select(imported.profile, imported.shape, [feature]);
  const plan = compile({
    ...selected,
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: ['a', 'b'],
  });
  const a: Driver = { open: (port) => ({ call: () => port.source('window.atob') }) };
  const b: Driver = { open: (port) => { port.source('window.atob'); return {}; } };
  assert.throws(
    () => engine.open(plan, { a, b }),
    (error: unknown) => error instanceof MimicError && error.phase === 'install' && error.code === 'INSTALL_FAILED',
  );
  assert.equal(engine.active, 0);

  const objectSource: Feature = {
    id: 'object-source',
    build: () => ({
      operations: [{
        op: 'alloc', id: 'object.source', kind: 'function', slot: 'object.source',
        shape: { name: 'source', length: 0, native: true, constructable: false, hasPrototype: false, keys: ['length', 'name'] },
      }],
      binds: [{ slot: 'object.source', driver: 'a', sources: ['window.document'] }],
    }),
  };
  const objectPlan = compile({
    ...select(imported.profile, imported.shape, [objectSource]),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }), engine: engine.manifest, drivers: ['a'],
  });
  assert.throws(
    () => engine.open(objectPlan, { a }),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_PLAN',
  );
  assert.equal(engine.active, 0);
});

test('JsdomEngine validates serialized Plans before creating a Realm', async () => {
  const imported = await store.load('chrome-mac');
  const engine = new JsdomEngine();
  const plan = compile({
    ...select(imported.profile, imported.shape, []),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: [],
  });
  const changed = JSON.parse(JSON.stringify(plan)) as typeof plan;
  (changed.boot as { url: string }).url = 'https://changed.example/';
  assert.throws(
    () => engine.open(changed),
    (error: unknown) => error instanceof MimicError && error.phase === 'parse' && error.code === 'BAD_PLAN',
  );
  assert.equal(engine.active, 0);
});

test('JsdomEngine contains timeout and always releases Driver and Realm state', async () => {
  const imported = await store.load('chrome-mac');
  const engine = new JsdomEngine();
  let closes = 0;
  const feature: Feature = {
    id: 'lifecycle',
    build: () => ({
      operations: [{
        op: 'alloc', id: 'life.fn', kind: 'function', slot: 'life',
        shape: { name: 'life', length: 0, native: true, constructable: false, hasPrototype: false, keys: ['length', 'name'] },
      }],
      binds: [{ slot: 'life', driver: 'life' }],
    }),
  };
  const life: Driver = {
    open: () => ({
      call: () => undefined,
      close: () => { closes++; throw new Error('close failed'); },
    }),
  };
  const plan = compile({
    ...select(imported.profile, imported.shape, [feature]),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: ['life'],
  });
  assert.throws(() => engine.open(plan), (error: unknown) => error instanceof MimicError && error.code === 'NO_DRIVER');
  assert.equal(engine.active, 0);

  const runtime = engine.open(plan, { life });
  const timed = runtime.run('while (true) {}', { timeout: 5 });
  assert.equal(timed.ok, false);
  assert.throws(() => runtime.dispose(), /close failed/);
  assert.equal(closes, 1);
  assert.equal(engine.active, 0);
  assert.doesNotThrow(() => runtime.dispose());
  assert.throws(
    () => runtime.run('1'),
    (error: unknown) => error instanceof MimicError && error.phase === 'run' && error.code === 'RUN_FAILED',
  );
  assert.throws(
    () => runtime.report(),
    (error: unknown) => error instanceof MimicError && error.phase === 'run' && error.code === 'RUN_FAILED',
  );
  assert.equal((runtime as unknown as { context: unknown }).context, null);
});
