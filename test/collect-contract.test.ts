import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv } from 'ajv';
import collectSchema from '../schemas/v2/collect.schema.json' with { type: 'json' };
import dataSchema from '../schemas/v2/data.schema.json' with { type: 'json' };
import { migrateCollect, parseCollect } from '../src/collect/contract.js';
import { MimicError } from '../src/core/error.js';
import { seal } from '../src/core/seal.js';

const profileRaw = {
  navigator: { userAgent: 'Mozilla/5.0 Chrome/149.0.0.0', language: 'zh-CN' },
  screen: { width: 1440, height: 900 },
};

const probeSnapshot = {
  meta: { source: 'chrome', ua: 'Mozilla/5.0 Chrome/149.0.0.0' },
  targets: [{ id: 'window.Navigator', category: 'object', ownKeys: ['constructor'] }],
};

function bundle() {
  return seal({
    schema: 2 as const,
    id: 'session-2026-07-13T10:00:00Z',
    profileRaw,
    probeSnapshot,
  });
}

function badCollect(action: () => unknown): MimicError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof MimicError);
  assert.equal(caught.code, 'BAD_COLLECT');
  assert.equal(caught.phase, 'parse');
  return caught;
}

test('Collect schema keeps one raw session envelope and permits either partial half', () => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  ajv.addSchema(dataSchema);
  const validate = ajv.compile(collectSchema);
  const hash = 'a'.repeat(64);
  const base = { schema: 2, id: 'session-1', hash };

  assert.equal(validate({ ...base, profileRaw, probeSnapshot }), true);
  assert.equal(validate({ ...base, profileRaw, probeSnapshot: null }), true);
  assert.equal(validate({ ...base, profileRaw: null, probeSnapshot }), true);
  assert.equal(validate({ ...base, profileRaw: null, probeSnapshot: null }), false);
  assert.equal(validate({ ...base, profileRaw }), false);
  assert.equal(validate({ ...base, profileRaw, probeSnapshot, profile: {} }), false);
  assert.equal(validate({ ...base, profileRaw, probeSnapshot, shape: {} }), false);
});

test('parseCollect returns a detached recursively frozen raw bundle', () => {
  const input = bundle();
  const parsed = parseCollect(input);

  assert.deepEqual(parsed, input);
  assert.notEqual(parsed, input);
  assert.notEqual(parsed.profileRaw, input.profileRaw);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.profileRaw), true);
  assert.equal(Object.isFrozen(parsed.probeSnapshot), true);
  assert.equal(Object.isFrozen((parsed.profileRaw as { navigator: object }).navigator), true);
});

test('parseCollect rejects content tampering, empty evidence, and derived root fields', () => {
  const valid = bundle();
  badCollect(() => parseCollect({ ...valid, profileRaw: { changed: true } }));
  badCollect(() => parseCollect(seal({ schema: 2, id: 'empty', profileRaw: null, probeSnapshot: null })));
  badCollect(() => parseCollect({ ...valid, profile: { id: 'derived' } }));
});

test('migrateCollect deterministically seals legacy v1 without modifying its input', () => {
  const legacy = {
    profileRaw: structuredClone(profileRaw),
    probeSnapshot: structuredClone(probeSnapshot),
  };
  const before = structuredClone(legacy);

  const first = migrateCollect(legacy);
  const second = migrateCollect({
    probeSnapshot: structuredClone(probeSnapshot),
    profileRaw: structuredClone(profileRaw),
  });

  assert.deepEqual(legacy, before);
  assert.deepEqual(first, second);
  assert.equal(first.schema, 2);
  assert.match(first.id, /^collect:[a-f0-9]{64}$/);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.profileRaw, legacy.profileRaw);
  assert.notEqual(first.probeSnapshot, legacy.probeSnapshot);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.profileRaw), true);
  assert.equal(Object.isFrozen(first.probeSnapshot), true);
  assert.deepEqual(parseCollect(first), first);
});

test('migrateCollect preserves either independently collected legacy half', () => {
  const identityOnly = migrateCollect({ profileRaw, probeSnapshot: null });
  const shapeOnly = migrateCollect({ profileRaw: null, probeSnapshot });

  assert.deepEqual(identityOnly.profileRaw, profileRaw);
  assert.equal(identityOnly.probeSnapshot, null);
  assert.equal(shapeOnly.profileRaw, null);
  assert.deepEqual(shapeOnly.probeSnapshot, probeSnapshot);
  assert.notEqual(identityOnly.id, shapeOnly.id);
});

test('migrateCollect parses schema 2 into a detached immutable value', () => {
  const input = bundle();
  const migrated = migrateCollect(input);

  assert.deepEqual(migrated, input);
  assert.notEqual(migrated, input);
  assert.equal(Object.isFrozen(migrated), true);
});

test('migrateCollect rejects unknown schemas and non-contract legacy payloads', () => {
  badCollect(() => migrateCollect({ schema: 3, id: 'future', profileRaw, probeSnapshot }));
  badCollect(() => migrateCollect({ profileRaw, probeSnapshot, profile: { id: 'derived' } }));
  badCollect(() => migrateCollect({ profileRaw: null, probeSnapshot: null }));
  badCollect(() => migrateCollect({ profileRaw }));
  badCollect(() => migrateCollect({ profileRaw, probeSnapshot, extra: undefined }));
});
