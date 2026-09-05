import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MimicError } from '../src/core/error.js';
import { digest } from '../src/core/seal.js';
import type { Data } from '../src/core/types.js';
import { normalizeIdentity } from '../src/profiles/normalize.js';
import { inferTarget } from '../src/profiles/target.js';
import { shapeForTarget } from '../src/profiles/shapes.js';
import type { NormalizationInput } from '../src/profiles/types.js';

async function facts(): Promise<NormalizationInput> {
  const raw = JSON.parse(await readFile('profiles/macos-chrome-v148.json', 'utf8')) as Record<string, Data>;
  const navigator = { ...raw.navigator! };
  delete navigator.connection;
  const screen = raw.screen!;
  const target = inferTarget({ navigator, screen });
  return {
    id: 'identity-without-format-metadata', target,
    shape: await shapeForTarget(target),
    source: { kind: 'capture', hash: digest(raw) },
    identity: { navigator, screen },
    captured: ['navigator', 'screen'],
    derived: ['navigator.vendor'],
    page: {
      url: 'https://example.test/', clock: { now: 123456, seed: 42 },
      connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
    },
  };
}

test('normalization accepts explicit facts without a Legacy name, traits or report document', async () => {
  const input = await facts();
  const before = JSON.stringify(input);
  const result = normalizeIdentity(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.profile.id, input.id);
  assert.deepEqual(result.profile.source, input.source);
  assert.equal(result.profile.evidence.navigator.fields.vendor, 'derived');
  assert.equal(result.profile.evidence.navigator.fields.userAgent, 'captured');
  assert.equal(result.profile.evidence.canvas.support, 'unsupported');
  assert.equal(result.page?.id, `${input.id}:default`);
  assert.equal(result.page?.url, input.page?.url);
  assert.deepEqual(result.page?.clock, input.page?.clock);
  assert.deepEqual(result.page?.connection, input.page?.connection);
  assert.equal('connection' in result.profile.navigator, false);
  assert.deepEqual(result.derived, [
    'navigator.vendor', 'navigator.userAgentData.wow64', 'screen.availLeft', 'screen.availTop',
  ]);
  assert.equal(result.profile.evidence.navigator.fields['userAgentData.wow64'], 'derived');
  assert.equal(result.profile.evidence.screen.fields.availLeft, 'derived');
});

test('normalization rejects incompatible Shapes before invalid identity fields', async () => {
  const input = await facts();
  input.identity.navigator.languages = [];
  assert.throws(
    () => normalizeIdentity({ ...input, target: { ...input.target, version: input.target.version + 1 } }),
    (error: unknown) => error instanceof MimicError && error.phase === 'parse' && error.code === 'BAD_SHAPE',
  );
  assert.throws(
    () => normalizeIdentity(input),
    (error: unknown) => error instanceof MimicError && error.phase === 'parse' && error.code === 'BAD_PROFILE',
  );
});
