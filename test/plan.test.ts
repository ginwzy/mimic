import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { Catalog, compile, explain, LegacyProfiles, MimicError, parseJob, parsePlan, parseProfile, parseShape, seal, type CompileInput, type Feature, type JsonValue, type Profile, type Shape } from '../src/index.js';
import { canonical } from '../src/core/canonical.js';
import { drivers as builtDrivers, features as builtFeatures } from '../src/features/index.js';

const store = new LegacyProfiles(path.resolve('profiles'));

function shapeFor(
  shape: Shape,
  features: readonly Feature[],
  ops: Shape['ops'] = [],
  support: Shape['support'] = { structure: shape.support.structure || shape.level },
): Shape {
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...new Set(features.map((feature) => feature.id))].sort(),
    ops,
    support,
  }));
}

function select(profile: Profile, shape: Shape, features: readonly Feature[]): { profile: Profile; catalog: Catalog } {
  const nextShape = shapeFor(shape, features);
  return { profile: profileFor(profile, nextShape), catalog: Catalog.create('test', [nextShape], features) };
}

function profileFor(profile: Profile, shape: Shape): Profile {
  const { hash: _hash, ...body } = profile;
  return parseProfile(seal({ ...body, shape: { id: shape.id, hash: shape.hash } }));
}

function forge(plan: unknown, mutate: (wire: Record<string, unknown>) => void): unknown {
  const wire = structuredClone(plan) as Record<string, unknown>;
  mutate(wire);
  const body = { ...wire };
  delete body.id;
  wire.id = createHash('sha256').update(canonical(body as JsonValue)).digest('hex');
  return wire;
}

const base: Feature = {
  id: 'base',
  build: () => ({
    operations: [{
      op: 'prop',
      target: { path: 'window' },
      key: 'oracle',
      desc: {
        kind: 'data',
        value: { json: 1 },
        writable: true,
        enumerable: true,
        configurable: true,
      },
    }],
    support: { oracle: 'emulated' },
  }),
};

const child: Feature = {
  id: 'child',
  requires: ['base'],
  build: () => ({
    operations: [
      {
        op: 'alloc', id: 'oracle.fn', kind: 'function',
        shape: {
          name: 'oracle',
          length: 0,
          native: true,
          constructable: false,
          hasPrototype: false,
          keys: ['length', 'name'],
        },
      },
    ],
  }),
};

test('compile creates a deterministic JSON Plan independent of feature registration order', async () => {
  const imported = await store.load('chrome-mac');
  assert.ok(imported.page);
  const selected = select(imported.profile, imported.shape, [base, child]);
  const input = {
    ...selected,
    page: imported.page,
    job: parseJob({ kind: 'run', code: '1 + 1' }),
    engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
    drivers: [],
  };

  const first = compile({ ...input, ...select(imported.profile, imported.shape, [child, base]) });
  const second = compile({ ...input, ...select(imported.profile, imported.shape, [base, child]) });

  assert.deepEqual(first, second);
  assert.deepEqual(first.features, ['base', 'child']);
  assert.deepEqual(first.operations.map((operation) => operation.op), ['alloc', 'prop']);
  assert.deepEqual(first.boot, {
    url: 'https://example.com/',
    html: '<!doctype html><html><head></head><body></body></html>',
    cookies: [],
  });
  assert.match(first.id, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => JSON.stringify(first));
  const replay = parsePlan(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(replay, first);
  assert.ok(Object.isFrozen(replay.operations));
  assert.equal(parsePlan(first), first);

  const { hash: _profileHash, ...profileBody } = selected.profile;
  const changed = compile({
    ...input,
    profile: seal({ ...profileBody, navigator: { ...selected.profile.navigator, language: 'changed' } }),
  });
  assert.notEqual(changed.id, first.id);

  assert.deepEqual(explain(first), {
    id: first.id,
    profile: 'chrome-mac',
    shape: 'chromium/chrome/macos/desktop/131',
    page: 'chrome-mac:default',
    task: 'run',
    engine: 'test@engine-shape-v1',
    catalog: `test@${selected.catalog.hash}`,
    features: ['base', 'child'],
    operations: { alloc: 1, proto: 0, prop: 1, drop: 0, fn: 0, order: 0 },
    drivers: [],
    support: { structure: 'derived', oracle: 'emulated' },
  });
});

test('compile accepts non-canonical Shape feature order and normalizes Plan features', async () => {
  const imported = await store.load('chrome-mac');
  const canonicalShape = shapeFor(imported.shape, [base, child]);
  const { hash: _shapeHash, ...shapeBody } = canonicalShape;
  const reversedShape = parseShape(seal({
    ...shapeBody,
    features: [...canonicalShape.features].reverse(),
  }));
  const plan = compile({
    profile: profileFor(imported.profile, reversedShape),
    catalog: Catalog.create('test', [reversedShape], [child, base]),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
    drivers: [],
  });

  assert.deepEqual(reversedShape.features, ['child', 'base']);
  assert.deepEqual(plan.features, ['base', 'child']);
});

test('compile requires explicit authorization for a mismatched Shape target and marks the Plan', async () => {
  const profileSource = await store.load('chrome-mac');
  const shapeSource = await store.load('macos-chrome-v148');
  const catalog = Catalog.create('test', [shapeSource.shape], builtFeatures);
  const input = {
    profile: profileSource.profile,
    shape: { id: shapeSource.shape.id, hash: shapeSource.shape.hash },
    catalog,
    job: parseJob({ kind: 'probe' }),
    engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
    drivers: Object.keys(builtDrivers),
  };

  assert.throws(
    () => compile(input),
    (error: unknown) => {
      assert.ok(error instanceof MimicError);
      assert.equal(error.phase, 'compile');
      assert.equal(error.code, 'SYNTHETIC_REQUIRED');
      assert.deepEqual(error.details, {
        fields: ['version'],
        profile: profileSource.shape.target,
        shape: shapeSource.shape.target,
      });
      return true;
    },
  );
  assert.throws(
    () => compile({ ...input, synthetic: 'yes' } as unknown as CompileInput),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_PLAN',
  );

  const plan = compile({ ...input, synthetic: true });
  assert.equal((plan as unknown as { synthetic?: true }).synthetic, true);
  assert.equal(plan.profile.id, profileSource.profile.id);
  assert.equal(plan.shape.id, shapeSource.shape.id);
  assert.deepEqual(parsePlan(JSON.parse(JSON.stringify(plan))), plan);
  assert.throws(
    () => parsePlan(forge(plan, (wire) => { wire.synthetic = false; })),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_PLAN',
  );
  assert.equal((explain(plan) as unknown as { synthetic?: true }).synthetic, true);
});

test('redundant synthetic authorization does not change a non-synthetic Plan', async () => {
  const imported = await store.load('macos-chrome-v148');
  const input = {
    profile: imported.profile,
    shape: { id: imported.shape.id, hash: imported.shape.hash },
    catalog: Catalog.create('test', [imported.shape], builtFeatures),
    job: parseJob({ kind: 'probe' }),
    engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
    drivers: Object.keys(builtDrivers),
  };

  const ordinary = compile(input);
  const authorized = compile({ ...input, synthetic: true });
  assert.deepEqual(authorized, ordinary);
  assert.equal(Object.hasOwn(authorized, 'synthetic'), false);
});

test('compile fails before Runtime creation on invalid feature plans', async () => {
  const imported = await store.load('chrome-mac');
  const page = imported.page;
  assert.ok(page);
  const input = (features: Feature[], overrides: Partial<CompileInput> = {}): CompileInput => {
    const selected = select(imported.profile, imported.shape, features);
    return {
      ...selected,
      page,
      job: parseJob({ kind: 'run', code: '1 + 1' }),
      engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
      drivers: [],
      ...overrides,
    };
  };
  const code = (run: () => unknown): string | undefined => {
    try {
      run();
      return undefined;
    } catch (error) {
      assert.ok(error instanceof MimicError);
      return error.code;
    }
  };

  const empty = (id: string, requires: string[] = []): Feature => ({ id, requires, build: () => ({}) });
  assert.equal(code(() => compile(input([empty('same'), empty('same')]))), 'DUPLICATE_FEATURE');
  assert.equal(code(() => compile(input([empty('a', ['missing'])]))), 'NO_FEATURE');
  const cycleA = empty('a', ['b']);
  const cycleB = empty('b', ['a']);
  assert.equal(code(() => compile(input([cycleA, cycleB]))), 'FEATURE_CYCLE');

  const write = (id: string): Feature => ({
    id,
    build: () => ({
      operations: [{
        op: 'prop', target: { path: 'window' }, key: 'same',
        desc: { kind: 'data', value: { json: 1 }, writable: true, enumerable: true, configurable: true },
      }],
    }),
  });
  assert.equal(code(() => compile(input([write('a'), write('b')]))), 'WRITE_CONFLICT');

  const functionShape = {
    name: 'atob', length: 1, native: true, constructable: false,
    hasPrototype: false, keys: ['length', 'name'],
  } as const;
  const directFn: Feature = {
    id: 'direct-fn',
    build: () => ({ operations: [{ op: 'fn', target: { path: 'window.atob' }, shape: functionShape }] }),
  };
  const propertyFn: Feature = {
    id: 'property-fn',
    build: () => ({ operations: [{
      op: 'fn', target: { path: 'window' }, key: 'atob', part: 'value', shape: functionShape,
    }] }),
  };
  const replaceFn: Feature = {
    id: 'replace-fn',
    build: () => ({ operations: [{
      op: 'prop', target: { path: 'window' }, key: 'atob',
      desc: { kind: 'data', value: { json: null }, writable: true, enumerable: true, configurable: true },
    }] }),
  };
  assert.equal(code(() => compile(input([directFn, propertyFn]))), 'WRITE_CONFLICT');
  assert.equal(code(() => compile(input([directFn, replaceFn]))), 'WRITE_CONFLICT');

  const needsDriver: Feature = {
    id: 'driver',
    build: () => ({
      operations: [{
        op: 'alloc', id: 'fetch.fn', kind: 'function', slot: 'fetch',
        shape: { name: 'fetch', length: 1, native: true, constructable: false, hasPrototype: false, keys: ['length', 'name'] },
      }],
      binds: [{ slot: 'fetch', driver: 'fetch' }],
    }),
  };
  assert.equal(code(() => compile(input([needsDriver]))), 'NO_DRIVER');

  const weak: Feature = { id: 'weak', build: () => ({ support: { canvas: 'shape-only' } }) };
  assert.equal(code(() => compile(input([weak], { require: { canvas: 'emulated' } }))), 'LOW_SUPPORT');

  assert.equal(code(() => compile(input([write('only')], {
    engine: {
      id: 'test',
      hash: 'engine-shape-v1',
      blocked: [{ op: 'prop', target: { path: 'window' }, key: 'same', reason: 'non-configurable' }],
    },
  }))), 'ENGINE_BLOCKED');

  const dangling: Feature = {
    id: 'dangling',
    build: () => ({ operations: [{ op: 'proto', target: { node: 'missing' }, value: { path: 'window.Object.prototype' } }] }),
  };
  assert.equal(code(() => compile(input([dangling]))), 'BAD_PLAN');

  const nonJson: Feature = {
    id: 'non-json',
    build: () => ({
      operations: [{
        op: 'prop', target: { path: 'window' }, key: 'bad',
        desc: {
          kind: 'data',
          value: { json: (() => 1) as unknown as null },
          writable: true,
          enumerable: true,
          configurable: true,
        },
      }],
    }),
  };
  assert.equal(code(() => compile(input([nonJson]))), 'BAD_PLAN');

  const badSupport: Feature = {
    id: 'bad-support',
    build: () => ({ support: { canvas: 'bogus' as 'captured' } }),
  };
  assert.equal(code(() => compile(input([badSupport], { require: { canvas: 'captured' } }))), 'BAD_PLAN');

  const badFnPart: Feature = {
    id: 'bad-fn-part',
    build: () => ({ operations: [{
      op: 'fn', target: { path: 'window' }, key: 'atob',
      shape: {
        name: 'atob', length: 1, native: true, constructable: false,
        hasPrototype: false, keys: ['length', 'name'],
      },
    } as never] }),
  };
  assert.equal(code(() => compile(input([badFnPart]))), 'BAD_PLAN');

  const dateConfig: Feature = {
    id: 'date-config',
    build: () => ({
      operations: [{
        op: 'alloc', id: 'date.fn', kind: 'function', slot: 'date',
        shape: { name: 'date', length: 0, native: true, constructable: false, hasPrototype: false, keys: ['length', 'name'] },
      }],
      binds: [{ slot: 'date', driver: 'date', config: new Date(0) as unknown as null }],
    }),
  };
  assert.equal(code(() => compile(input([dateConfig], { drivers: ['date'] }))), 'BAD_PLAN');

  const orphanBind: Feature = {
    id: 'orphan-bind',
    build: () => ({ binds: [{ slot: 'orphan', driver: 'driver' }] }),
  };
  assert.equal(code(() => compile(input([orphanBind], { drivers: ['driver'] }))), 'BAD_PLAN');

  const orphanSlot: Feature = {
    id: 'orphan-slot',
    build: () => ({ operations: [{
      op: 'alloc', id: 'orphan.fn', kind: 'function', slot: 'orphan',
      shape: { name: 'orphan', length: 0, native: true, constructable: false, hasPrototype: false, keys: ['length', 'name'] },
    }] }),
  };
  assert.equal(code(() => compile(input([orphanSlot], { drivers: ['driver'] }))), 'BAD_PLAN');
});

test('compile returns a detached, deeply immutable Plan with locale-independent ordering', async () => {
  const imported = await store.load('chrome-mac');
  const mutable = {
    op: 'prop' as const,
    target: { path: 'window' },
    key: 'mutable',
    desc: { kind: 'data' as const, value: { json: 1 }, writable: true, enumerable: true, configurable: true },
  };
  const features: Feature[] = [
    { id: 'y', build: () => ({}) },
    { id: 'z', build: () => ({}) },
    { id: 'a', build: () => ({ operations: [mutable] }) },
  ];
  const selected = select(imported.profile, imported.shape, features);
  const plan = compile({
    ...selected,
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
    drivers: [],
  });

  assert.deepEqual(plan.features, ['a', 'y', 'z']);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.operations));
  assert.ok(Object.isFrozen(plan.operations[0]));
  assert.throws(() => (plan.features as string[]).push('changed'));
  mutable.desc.value.json = 2;
  assert.equal((plan.operations[0] as typeof mutable).desc.value.json, 1);
});

test('parsePlan rejects rehashed graph forgeries that bypass per-operation validation', async () => {
  const imported = await store.load('chrome-mac');
  const selected = select(imported.profile, imported.shape, [base, child]);
  const plan = compile({
    ...selected,
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
    drivers: [],
  });
  const bad = (value: unknown): void => assert.throws(
    () => parsePlan(value),
    (error: unknown) => error instanceof MimicError && error.phase === 'parse' && error.code === 'BAD_PLAN',
  );
  const operations = (wire: Record<string, unknown>): Array<Record<string, unknown>> => (
    wire.operations as Array<Record<string, unknown>>
  );

  bad(forge(plan, (wire) => {
    const ops = operations(wire);
    ops.push(structuredClone(ops.at(-1)!));
  }));
  bad(forge(plan, (wire) => {
    const ops = operations(wire);
    ops.splice(1, 0, structuredClone(ops[0]!));
  }));
  bad(forge(plan, (wire) => {
    const op = operations(wire).find((item) => item.op === 'prop')!;
    op.target = { node: 'missing' };
  }));
  bad(forge(plan, (wire) => {
    operations(wire).push({
      op: 'fn', target: { path: 'window.oracle' }, feature: 'base',
      shape: {
        name: 'oracle', length: 0, native: true, constructable: false,
        hasPrototype: false, keys: ['length', 'name'],
      },
    });
  }));
  bad(forge(plan, (wire) => {
    operations(wire).reverse();
  }));

  const slotFeature: Feature = {
    id: 'slot',
    build: () => ({
      operations: [{
        op: 'alloc', id: 'slot.fn', kind: 'function', slot: 'slot',
        shape: {
          name: 'slot', length: 0, native: true, constructable: false,
          hasPrototype: false, keys: ['length', 'name'],
        },
      }],
      binds: [{ slot: 'slot', driver: 'slot' }],
    }),
  };
  const slotPlan = compile({
    ...select(imported.profile, imported.shape, [slotFeature]),
    job: parseJob({ kind: 'probe' }),
    engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
    drivers: ['slot'],
  });
  bad(forge(slotPlan, (wire) => {
    const duplicate = structuredClone(operations(wire)[0]!);
    duplicate.id = 'other.fn';
    operations(wire).push(duplicate);
  }));
  bad(forge(slotPlan, (wire) => {
    const binds = wire.binds as Array<Record<string, unknown>>;
    binds.push(structuredClone(binds[0]!));
  }));
  bad(forge(slotPlan, (wire) => {
    (wire.binds as Array<Record<string, unknown>>)[0]!.slot = 'missing';
  }));
  bad(forge(slotPlan, (wire) => {
    wire.binds = [];
  }));
});

test('compile only reuses prepared Shape data from an immutable Catalog result', async () => {
  const imported = await store.load('chrome-mac');
  const selected = select(imported.profile, imported.shape, [base]);
  const mutableShape = structuredClone(selected.catalog.list()[0]!);
  const catalog = {
    id: selected.catalog.id,
    hash: selected.catalog.hash,
    resolve: () => ({ shape: mutableShape, features: [base] }),
  };
  const input: CompileInput = {
    profile: selected.profile,
    catalog,
    job: parseJob({ kind: 'probe' }),
    engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
    drivers: [],
  };

  const first = compile(input);
  assert.equal(first.operations.length, 1);
  mutableShape.ops.push({ op: 'unknown' });
  assert.throws(
    () => compile(input),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_SHAPE',
  );
});

test('compile treats Shape operations, support, and feature selection as authoritative', async () => {
  const imported = await store.load('chrome-mac');
  const shapeOp = {
    op: 'prop' as const,
    target: { path: 'window' },
    key: 'fromShape',
    desc: { kind: 'data' as const, value: { json: true }, writable: false, enumerable: true, configurable: true },
  };
  const shape = shapeFor(imported.shape, [], [shapeOp], { surface: 'captured' });
  const catalog = Catalog.create('test', [shape]);
  const plan = compile({
    profile: profileFor(imported.profile, shape),
    catalog,
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
    drivers: [],
  });
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0]?.feature, '_shape');
  assert.deepEqual(plan.support, { surface: 'captured' });

  assert.throws(
    () => shapeFor(imported.shape, [], [{ op: 'unknown' } as never]),
    (error: unknown) => error instanceof MimicError && error.phase === 'parse' && error.code === 'BAD_SHAPE',
  );

  const missing: Feature = { id: 'extra', build: () => ({}) };
  const missingShape = shapeFor(imported.shape, [missing]);
  assert.throws(
    () => compile({
      profile: profileFor(imported.profile, missingShape), catalog: Catalog.create('test', [missingShape]),
      job: parseJob({ kind: 'probe' }), engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
      drivers: [],
    }),
    (error: unknown) => error instanceof MimicError && error.code === 'NO_FEATURE',
  );
});

test('compile contains Feature identity mutation and foreign error phases', async () => {
  const imported = await store.load('chrome-mac');
  const mutator: Feature = {
    id: 'mutator',
    build() {
      (this as unknown as { id: string }).id = 'changed';
      return {};
    },
  };
  const foreign: Feature = {
    id: 'foreign',
    build: () => { throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: 'forged' }); },
  };
  for (const feature of [mutator, foreign]) {
    const selected = select(imported.profile, imported.shape, [feature]);
    assert.throws(
      () => compile({
        ...selected,
        job: parseJob({ kind: 'probe' }), engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
        drivers: [],
      }),
      (error: unknown) => error instanceof MimicError && error.phase === 'compile' && error.code === 'BAD_PLAN',
    );
  }
});

test('compile produces a unique base Plan for every migrated Profile', async () => {
  const ids = await store.list();
  const plans = new Set<string>();
  const catalogs = new Map<string, Catalog>();
  for (const id of ids) {
    const imported = await store.load(id);
    let catalog = catalogs.get(imported.shape.hash);
    if (!catalog) {
      catalog = Catalog.create('test', [imported.shape], builtFeatures);
      catalogs.set(imported.shape.hash, catalog);
    }
    const plan = compile({
      profile: imported.profile,
      catalog,
      ...(imported.page ? { page: imported.page } : {}),
      job: parseJob({ kind: 'probe' }),
      engine: { id: 'test', hash: 'engine-shape-v1', blocked: [] },
      drivers: Object.keys(builtDrivers),
    });
    plans.add(plan.id);
    assert.equal(Object.hasOwn(plan, 'synthetic'), false, id);
    assert.doesNotThrow(() => JSON.stringify(plan), id);
  }
  assert.equal(plans.size, 1012);
});
