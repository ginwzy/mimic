import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { migrateCollect } from '../src/collect/contract.js';
import { normalizeCollect } from '../src/collect/normalize.js';
import { MimicError } from '../src/core/error.js';
import { createNodeApplication } from '../src/node/app.js';

async function fixture() {
  const profileRaw = JSON.parse(await readFile(path.resolve('profiles/android-webview-v138.json'), 'utf8')) as {
    meta: Record<string, unknown>;
    navigator: { userAgent: string };
  };
  delete profileRaw.meta.name;
  delete profileRaw.meta.traits;

  const probeSnapshot = JSON.parse(await readFile(path.resolve('resources/baselines/android-webview-v138.json'), 'utf8')) as {
    meta: Record<string, unknown>;
    targets: Array<{ id: string; resolved: boolean }>;
  };
  delete probeSnapshot.meta.profile;
  return { profileRaw, probeSnapshot };
}

function badCollect(error: unknown): boolean {
  return error instanceof MimicError && error.phase === 'parse' && error.code === 'BAD_COLLECT';
}

test('normalizeCollect deterministically derives one correlated Profile and Shape without mutating raw evidence', async () => {
  const raw = await fixture();
  const before = JSON.stringify(raw);
  const bundle = migrateCollect(raw);

  const first = normalizeCollect(bundle);
  const second = normalizeCollect(bundle);

  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(first, second);
  assert.equal(first.capture.id, bundle.id);
  assert.equal(first.capture.hash, bundle.hash);
  assert.match(first.profile.id, /^android-webview-v138-[a-f0-9]{12}$/);
  assert.equal(first.profile.shape.id, 'chromium/webview/android/mobile/138');
  assert.equal(first.profile.shape.hash, first.shape.hash);
  assert.equal(first.shape.level, 'derived');
  assert.equal(first.shape.support.structure, 'derived');
  assert.equal(first.shape.support['probe.structure'], 'captured');
  assert.equal(first.shape.support['probe.functions'], 'captured');
  assert.equal(first.shape.support['probe.descriptors'], 'captured');
  assert.equal(first.shape.support['probe.prototypes'], 'captured');
  assert.equal(first.shape.support['probe.order'], 'captured');
  assert.equal(first.profile.source.kind, 'capture');
  assert.equal(first.shape.source.kind, 'capture');
});

test('normalizeCollect lowers probe function, descriptor, prototype, and key-order evidence into Shape IR', async () => {
  const raw = await fixture();
  const changed = structuredClone(raw) as unknown as {
    profileRaw: typeof raw.profileRaw;
    probeSnapshot: {
      meta: Record<string, unknown>;
      targets: Array<{
        id: string;
        fn?: { length?: number };
        ownKeys?: string[];
        protoChain?: string[];
        keys?: Record<string, { flags?: { enumerable?: boolean } }>;
      }>;
    };
  };
  const alert = changed.probeSnapshot.targets.find(({ id }) => id === 'window.alert');
  const navigator = changed.probeSnapshot.targets.find(({ id }) => id === 'Navigator.prototype');
  assert.ok(alert?.fn && navigator?.ownKeys && navigator.protoChain && navigator.keys?.userAgent?.flags);
  alert.fn.length = 7;
  navigator.ownKeys = [...navigator.ownKeys.slice(1), navigator.ownKeys[0]!];
  navigator.protoChain[0] = 'EventTarget.prototype';
  navigator.keys.userAgent!.flags!.enumerable = false;

  const normalized = normalizeCollect(migrateCollect(changed));
  const shape = normalized.shape;
  const ops = shape.ops as Array<Record<string, any>>;
  const alertAllocation = ops.find((op) => op.op === 'alloc' && op.shape?.name === 'alert');
  const userAgent = ops.find((op) => op.op === 'prop'
    && op.target?.path === 'window.Navigator.prototype' && op.key === 'userAgent');
  const prototype = ops.find((op) => op.op === 'proto' && op.target?.path === 'window.Navigator.prototype');
  const order = ops.find((op) => op.op === 'order' && op.target?.path === 'window.Navigator.prototype');

  assert.equal(alertAllocation?.shape.length, 7);
  assert.equal(userAgent?.desc.enumerable, false);
  assert.deepEqual(prototype?.value, { path: 'window.EventTarget.prototype' });
  assert.deepEqual(order?.keys.slice(0, navigator.ownKeys.length), navigator.ownKeys);

  const app = createNodeApplication({
    profiles: {
      load: async () => ({
        profile: normalized.profile,
        ...(normalized.page === undefined ? {} : { page: normalized.page }),
        shape,
      }),
      list: async () => [normalized.profile.id],
    },
    probePath: path.resolve('resources/probe.js'),
  });
  const result = await app.execute({
    profile: normalized.profile.id,
    job: {
      kind: 'run',
      code: '[alert.length, Object.getPrototypeOf(Navigator.prototype) === EventTarget.prototype, Object.getOwnPropertyDescriptor(Navigator.prototype, "userAgent").enumerable]',
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, [7, true, false]);
});

test('normalizeCollect rejects partial evidence and cross-session UA or host contradictions', async () => {
  const raw = await fixture();
  const partial = migrateCollect({ profileRaw: raw.profileRaw, probeSnapshot: null });
  assert.throws(() => normalizeCollect(partial), badCollect);

  const wrongUa = structuredClone(raw);
  wrongUa.probeSnapshot.meta.ua = 'Mozilla/5.0 Chrome/1.0';
  assert.throws(() => normalizeCollect(migrateCollect(wrongUa)), badCollect);

  const wrongHost = structuredClone(raw);
  const chrome = wrongHost.probeSnapshot.targets.find(({ id }) => id === 'window.chrome');
  assert.ok(chrome);
  chrome.resolved = true;
  assert.throws(() => normalizeCollect(migrateCollect(wrongHost)), badCollect);
});
