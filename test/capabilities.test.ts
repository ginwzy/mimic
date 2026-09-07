import assert from 'node:assert/strict';
import test from 'node:test';
import { Catalog } from '../src/catalog/index.js';
import { compile, compileWithCapabilities } from '../src/compile/index.js';
import { assertCapabilities, projectSupport } from '../src/core/capabilities.js';
import { parseProfile } from '../src/core/parse.js';
import { digest, seal } from '../src/core/seal.js';
import type { JsonValue } from '../src/core/types.js';
import { features, driverIds } from '../src/features/compile.js';
import { jsdomManifest } from '../src/engine/manifest.js';
import { createNodePlanner } from '../src/node/planner.js';
import { FixtureProfiles } from './fixtures.js';
import { memoryBudget } from '../src/quality/memory.js';

test('capability sidecars are immutable and preserve v2 support and cached Plan identity', async () => {
  const planner = createNodePlanner({ profiles: new FixtureProfiles() });
  const request = { profile: 'chrome-mac', job: { kind: 'run' as const, code: '42' } };
  const first = await planner.inspect(request);
  assert.equal(await planner.plan(request), first.plan);
  assert.equal((await planner.inspect(request)).capabilities, first.capabilities);
  assert.deepEqual(projectSupport(first.capabilities.entries), first.plan.support);
  assert.deepEqual(first.capabilities.entries['canvas.fingerprint'], { legacy: 'derived', origin: 'synthetic', coverage: 'constant' });
  assert.deepEqual(first.capabilities.entries['audio.render'], { legacy: 'emulated', origin: 'emulated', coverage: 'constant' });
  assert.ok(Object.isFrozen(first.capabilities.entries['canvas.fingerprint']));
  const { hash, ...body } = first.capabilities;
  assert.equal(hash, digest(body as unknown as JsonValue));
  await assert.rejects(planner.inspect(request, { 'canvas.fingerprint': { origins: ['captured'] } }), { code: 'LOW_SUPPORT' });
  await planner.inspect(request, { 'canvas.fingerprint': { origins: ['synthetic'], coverage: ['constant'] } });
  assert.throws(() => assertCapabilities(first.capabilities, { missing: { coverage: ['none'] } }), { code: 'LOW_SUPPORT' });
  assert.throws(() => assertCapabilities(first.capabilities, { 'canvas.fingerprint': { coverage: [] } }), TypeError);
});

test('captured fingerprint constants do not satisfy complete rendering requirements', async () => {
  const imported = await new FixtureProfiles().load('chrome-mac');
  const { hash: _hash, ...body } = imported.profile;
  const profile = parseProfile(seal({ ...body, canvas: { toDataURL: 'data:image/png;base64,AAAA' },
    evidence: { ...body.evidence, canvas: { ...body.evidence.canvas, support: 'captured', fields: { toDataURL: 'captured' } } } }));
  const input = { profile, job: { kind: 'run' as const, code: '42' },
    catalog: Catalog.create('test', [imported.shape], features), engine: jsdomManifest(), drivers: driverIds };
  const output = compileWithCapabilities({ ...input, require: { 'canvas.fingerprint': 'captured' } });
  assert.equal(output.capabilities.entries['canvas.fingerprint']?.origin, 'captured');
  assert.equal(output.capabilities.entries['canvas.fingerprint']?.coverage, 'constant');
  assert.throws(() => compileWithCapabilities({ ...input, requireCapabilities: { 'canvas.fingerprint': { coverage: ['complete'] } } }), { code: 'LOW_SUPPORT' });
  assert.equal(compile(input).id, output.plan.id);
});

test('custom Features keep compatibility without implicit behavior claims', async () => {
  const imported = await new FixtureProfiles().load('chrome-mac');
  const bare = features.map(({ describe: _describe, ...feature }) => feature);
  const input = { profile: imported.profile, job: { kind: 'run' as const, code: '42' },
    catalog: Catalog.create('test', [imported.shape], bare), engine: jsdomManifest(), drivers: driverIds };
  const output = compileWithCapabilities(input);
  assert.equal(output.capabilities.entries['canvas.runtime']?.coverage, 'unknown');
  assert.throws(() => assertCapabilities(output.capabilities, { 'canvas.runtime': { coverage: ['partial'] } }), { code: 'LOW_SUPPORT' });
  const reviewed = compileWithCapabilities({ ...input, catalog: Catalog.create('test', [imported.shape], features) });
  assert.equal(output.plan.id, reviewed.plan.id);
  assert.notEqual(output.capabilities.hash, reviewed.capabilities.hash);
});

test('disabled modes retain none coverage rather than inheriting enabled behavior', async () => {
  const planner = createNodePlanner({ profiles: new FixtureProfiles() });
  const run = await planner.inspect({ profile: 'chrome-mac', job: { kind: 'run', code: '1' } });
  const capture = await planner.inspect({ profile: 'chrome-mac', job: { kind: 'capture', code: '1', trace: true } });
  assert.equal(run.capabilities.entries['net.capture']?.coverage, 'none');
  assert.equal(run.capabilities.entries['trace.capture']?.coverage, 'none');
  assert.equal(capture.capabilities.entries['net.forward']?.coverage, 'none');
  assert.equal(capture.capabilities.entries['trace.capture']?.coverage, 'partial');
  const older = await planner.inspect({ profile: 'android-webview-v138', job: { kind: 'run', code: '1' } });
  assert.ok(!older.plan.features.includes('chrome'));
  assert.equal(older.capabilities.entries['window.secure-context']?.coverage, 'constant');
});

test('memory observations never pass an unconfigured memory gate', () => {
  const growth = { rss: 2 * 1024 * 1024, mainHeap: 1024, workerHeap: 4 * 1024 * 1024 };
  assert.equal(memoryBudget(growth, {}).status, 'observed');
  assert.equal(memoryBudget(growth, { rssBudgetMiB: 1 }).status, 'failed');
  assert.equal(memoryBudget(growth, { rssBudgetMiB: 3, heapBudgetMiB: 1 }).status, 'failed');
  assert.equal(memoryBudget(growth, { rssBudgetMiB: 3, heapBudgetMiB: 5 }).status, 'passed');
});
