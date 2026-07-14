import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CatalogFiles } from '../src/catalog/files.js';
import { MimicError } from '../src/core/error.js';
import { parseShape } from '../src/core/parse.js';
import { seal } from '../src/core/seal.js';
import type { Shape, Target } from '../src/core/types.js';
import type { Feature } from '../src/shape/types.js';

const sourceHash = 'a'.repeat(64);

function shape(target: Target, featureIds: string[] = []): Shape {
  return parseShape(seal({
    schema: 2 as const,
    id: `chromium/${target.host}/${target.platform}/${target.form}/${target.version}`,
    target,
    level: 'captured' as const,
    source: { kind: 'capture' as const, hash: sourceHash },
    features: featureIds,
    ops: [],
    support: {},
  }));
}

async function directory(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mimic-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function badShape(error: unknown): boolean {
  return error instanceof MimicError && error.phase === 'parse' && error.code === 'BAD_SHAPE';
}

const feature: Feature = { id: 'fixture', build: () => ({}) };
const linux = shape({ engine: 'chromium', host: 'chrome', platform: 'linux', form: 'desktop', version: 143 }, [feature.id]);
const macos = shape({ engine: 'chromium', host: 'chrome', platform: 'macos', form: 'desktop', version: 149 }, [feature.id]);

test('CatalogFiles.load parses direct JSON files, sorts Shapes, and delegates Features to Catalog', async (t) => {
  const root = await directory(t);
  await writeFile(path.join(root, 'z.json'), JSON.stringify(macos));
  await writeFile(path.join(root, 'a.json'), JSON.stringify(linux));
  await writeFile(path.join(root, 'notes.txt'), '{not json');
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'nested', 'ignored.json'), JSON.stringify(linux));

  const catalog = await CatalogFiles.load(root, [feature]);

  assert.equal(catalog.id, 'files');
  assert.deepEqual(catalog.list().map(({ id }) => id), [linux.id, macos.id]);
  assert.deepEqual(
    catalog.resolve({ id: linux.id, hash: linux.hash }).features.map(({ id, rev }) => ({ id, rev })),
    [{ id: feature.id, rev: '1' }],
  );
});

test('CatalogFiles.rebuild is deterministic for the same Shape set', () => {
  const first = CatalogFiles.rebuild([macos, linux], 'captured', [feature]);
  const second = CatalogFiles.rebuild([linux, macos], 'captured', [feature]);

  assert.equal(first.id, 'captured');
  assert.equal(first.hash, second.hash);
  assert.deepEqual(first.data, second.data);
});

test('CatalogFiles rejects invalid roots and JSON file paths', async (t) => {
  const root = await directory(t);
  const file = path.join(root, 'catalog.json');
  await writeFile(file, JSON.stringify(linux));
  const linked = path.join(root, 'linked.json');
  await symlink(file, linked);

  await assert.rejects(CatalogFiles.load(''), badShape);
  await assert.rejects(CatalogFiles.load(file), badShape);
  await assert.rejects(CatalogFiles.load(root, [feature]), badShape);
});

test('CatalogFiles rejects malformed JSON and invalid Shape content', async (t) => {
  const malformed = await directory(t);
  await writeFile(path.join(malformed, 'bad.json'), '{');
  await assert.rejects(CatalogFiles.load(malformed), badShape);

  const tampered = await directory(t);
  await writeFile(path.join(tampered, 'bad.json'), JSON.stringify({ ...linux, level: 'derived' }));
  await assert.rejects(CatalogFiles.load(tampered, [feature]), badShape);
});

test('CatalogFiles rejects duplicate Shape ids from files and rebuild input', async (t) => {
  const root = await directory(t);
  await writeFile(path.join(root, 'one.json'), JSON.stringify(linux));
  await writeFile(path.join(root, 'two.json'), JSON.stringify(linux));

  await assert.rejects(CatalogFiles.load(root, [feature]), badShape);
  assert.throws(() => CatalogFiles.rebuild([linux, linux], 'captured', [feature]), badShape);
});
