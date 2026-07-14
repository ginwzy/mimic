import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateCollect } from '../../src/v2/collect/contract.js';
import { CollectStore } from '../../src/v2/collect/store.js';
import { MimicError } from '../../src/v2/core/error.js';
import { createNodeApplication } from '../../src/v2/node/app.js';
import { ProfileFiles } from '../../src/v2/profile/files.js';

const FIXTURES = {
  'android-webview-v138': 'android-webview-v138',
  'macos-chrome-v148': 'macos-chrome-v148',
} as const;

async function fixture(name: keyof typeof FIXTURES = 'android-webview-v138') {
  const profileRaw = JSON.parse(await readFile(path.resolve(`profiles/${name}.json`), 'utf8')) as {
    meta: Record<string, unknown>;
  };
  delete profileRaw.meta.name;
  delete profileRaw.meta.traits;
  const probeSnapshot = JSON.parse(await readFile(path.resolve(`resources/v2/baselines/${FIXTURES[name]}.json`), 'utf8')) as {
    meta: Record<string, unknown>;
  };
  delete probeSnapshot.meta.profile;
  return { profileRaw, probeSnapshot };
}

test('CollectStore serializes concurrent append transactions across instances sharing one root', async (t) => {
  const root = await directory(t);
  const inputs = await Promise.all([
    fixture('android-webview-v138'),
    fixture('macos-chrome-v148'),
  ]);
  const receipts = await Promise.all(inputs.map((input) => (
    new CollectStore(root).append(migrateCollect(input))
  )));
  const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8')) as {
    shapes: Array<{ id: string }>;
  };

  assert.deepEqual(
    catalog.shapes.map(({ id }) => id),
    receipts.map((receipt) => receipt.artifacts!.shape.id).sort(),
  );
});

async function directory(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimic-v2-collect-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('CollectStore appends immutable raw evidence and rebuilds byte-identical derived artifacts', async (t) => {
  const root = await directory(t);
  const store = new CollectStore(root);
  const bundle = migrateCollect(await fixture());

  const first = await store.append(bundle);
  const captureBytes = await readFile(first.files.capture, 'utf8');
  const derived = await Promise.all([
    readFile(first.files.profile!, 'utf8'),
    readFile(first.files.shape!, 'utf8'),
    readFile(first.files.catalog!, 'utf8'),
  ]);
  const repeated = await store.append(bundle);

  assert.equal(await readFile(repeated.files.capture, 'utf8'), captureBytes);
  assert.equal(first.artifacts?.profile.hash, repeated.artifacts?.profile.hash);
  assert.equal(first.artifacts?.shape.hash, repeated.artifacts?.shape.hash);

  await Promise.all([
    rm(path.join(root, 'profiles'), { recursive: true, force: true }),
    rm(path.join(root, 'pages'), { recursive: true, force: true }),
    rm(path.join(root, 'shapes'), { recursive: true, force: true }),
    rm(path.join(root, 'catalog.json'), { force: true }),
  ]);
  const rebuilt = await store.rebuild();
  assert.equal(rebuilt.length, 1);
  assert.deepEqual(await Promise.all([
    readFile(first.files.profile!, 'utf8'),
    readFile(first.files.shape!, 'utf8'),
    readFile(first.files.catalog!, 'utf8'),
  ]), derived);
});

test('ProfileFiles exposes collected artifacts through the common Application port', async (t) => {
  const root = await directory(t);
  const stored = await new CollectStore(root).append(migrateCollect(await fixture()));
  assert.ok(stored.artifacts);
  const profiles = new ProfileFiles(root);
  assert.deepEqual(await profiles.list(), [stored.artifacts.profile.id]);

  const loaded = await profiles.load(stored.artifacts.profile.id);
  assert.equal(loaded.profile.hash, stored.artifacts.profile.hash);
  assert.equal(loaded.shape.hash, stored.artifacts.shape.hash);

  const app = createNodeApplication({ profiles });
  const result = await app.execute({
    profile: loaded.profile.id,
    job: { kind: 'run', code: '({ ua: navigator.userAgent, width: screen.width })' },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { ua: loaded.profile.navigator.userAgent, width: loaded.profile.screen.width });
});

test('CollectStore preserves partial raw evidence and rejects conflicting Shapes without overwriting Catalog', async (t) => {
  const root = await directory(t);
  const store = new CollectStore(root);
  const raw = await fixture();
  const first = await store.append(migrateCollect(raw));
  const catalog = await readFile(first.files.catalog!, 'utf8');

  const changed = structuredClone(raw);
  changed.probeSnapshot.meta.note = 'different raw structure evidence';
  await assert.rejects(
    store.append(migrateCollect(changed)),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_SHAPE',
  );
  assert.equal(await readFile(first.files.catalog!, 'utf8'), catalog);

  const partial = await store.append(migrateCollect({ profileRaw: raw.profileRaw, probeSnapshot: null }));
  assert.equal(partial.artifacts, undefined);
  assert.equal(typeof partial.files.capture, 'string');
});
