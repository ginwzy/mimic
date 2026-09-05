import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { LegacyProfiles } from '../src/legacy/profiles.js';
import { MimicError } from '../src/core/error.js';
import { parseShape } from '../src/core/parse.js';
import { seal } from '../src/core/seal.js';
import { shape } from '../src/features/shape.js';
import { features, driverIds } from '../src/features/compile.js';
import { drivers } from '../src/features/drivers.js';
import { fnShape } from '../src/features/ops.js';

const store = new LegacyProfiles(path.resolve('profiles'));

async function base() {
  const imported = await store.load('chrome-mac');
  const { hash: _hash, ...body } = imported.shape;
  return parseShape(seal({ ...body, features: [], ops: [], support: { structure: body.level } }));
}

test('Shape composition resolves dependencies once and is idempotent', async () => {
  const input = await base();
  const screen = shape(input, ['screen']);
  assert.deepEqual(screen.features, ['screen', 'view']);
  assert.deepEqual(shape(screen, ['screen', 'view']), screen);
  const full = shape(input);
  assert.deepEqual(shape(full), full);
  assert.deepEqual(input.features, []);
  assert.deepEqual(input.ops, []);
});

test('Shape composition preserves ownership even when a reserved Feature is not selected', async () => {
  const dom = shape(await base(), ['dom']);
  assert.equal(dom.features.includes('net'), false);
  assert.equal(dom.ops.some(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    return raw.op === 'fn' && raw.key === 'send'
      && JSON.stringify(raw.target) === JSON.stringify({ path: 'window.XMLHttpRequest.prototype' });
  }), false);
  const net = shape(dom, ['net']);
  assert.equal(net.features.filter(id => id === 'net').length, 1);
  assert.deepEqual(shape(net, ['net']), net);
});

test('Shape composition rejects aliased callable writes and unknown Features', async () => {
  const { hash: _hash, ...body } = await base();
  const input = parseShape(seal({ ...body, ops: [
    { op: 'fn', target: { path: 'window.XMLHttpRequest.prototype.send' }, shape: fnShape('send', 1) },
    { op: 'fn', target: { path: 'window.XMLHttpRequest.prototype' }, key: 'send', part: 'value', shape: fnShape('send', 1) },
  ] }));
  assert.throws(() => shape(input, []), (error: unknown) => error instanceof MimicError && error.code === 'WRITE_CONFLICT');
  assert.throws(() => shape(parseShape(seal(body)), ['unknown']),
    (error: unknown) => error instanceof MimicError && error.code === 'NO_FEATURE');
});

test('compile driver identifiers match the execute-only registry', () => {
  assert.deepEqual([...driverIds].sort(), Object.keys(drivers).sort());
  assert.equal(new Set(driverIds).size, features.length);
});
