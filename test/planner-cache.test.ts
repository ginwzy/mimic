import assert from 'node:assert/strict';
import test from 'node:test';
import { Planner } from '../src/app/planner.js';
import { jsdomManifest } from '../src/engine/manifest.js';
import { features, driverIds } from '../src/features/compile.js';
import type { Feature } from '../src/shape/types.js';
import { FixtureProfiles } from './fixtures.js';

const trace = features.find(feature => feature.id === 'trace')!;

function planner(replacement: Feature) {
  return new Planner({
    profiles: new FixtureProfiles(), engine: jsdomManifest(), drivers: driverIds,
    features: features.map(feature => feature.id === replacement.id ? replacement : feature),
  });
}

test('declared installation dependencies avoid recompiling and retaining script variants', async () => {
  let builds = 0;
  const app = planner({ ...trace, build: context => { builds++; return trace.build(context); } });
  const request = { profile: 'chrome-mac', job: { kind: 'run' as const, code: '1' } };
  const first = await app.inspect(request);
  for (let index = 0; index < 160; index++) {
    const next = await app.inspect({ ...request, job: { ...request.job, code: `1; // ${index}`, timeout: index + 1 } });
    assert.strictEqual(next, first);
  }
  assert.equal(builds, 1);
  const traced = await app.inspect({ ...request, job: { ...request.job, trace: true } });
  assert.notEqual(traced.plan.id, first.plan.id);
  assert.equal(builds, 2);
});

test('undeclared custom Features retain full Job dependencies including code and interaction seed', async () => {
  const { jobKeys: _keys, describe: _describe, ...custom } = trace;
  let builds = 0;
  const app = planner({
    ...custom,
    build: context => {
      builds++;
      const { job } = context;
      const marker = job.kind === 'capture' ? job.interaction?.seed : 'code' in job ? job.code : '';
      return { ...trace.build(context), support: { 'custom.job': marker === 'a' ? 'captured' : 'derived' } };
    },
  });
  for (const kind of ['run', 'capture'] as const) {
    const request = (value: string) => ({ profile: 'chrome-mac', job: kind === 'run'
      ? { kind, code: value }
      : { kind, code: '1', interaction: { adapter: 'akamai-sensor' as const, seed: value } } });
    const first = await app.plan(request('a'));
    const second = await app.plan(request('b'));
    assert.equal(first.support['custom.job'], 'captured');
    assert.equal(second.support['custom.job'], 'derived');
    assert.notEqual(first.id, second.id);
    assert.strictEqual(await app.plan(request('a')), first);
  }
  assert.equal(builds, 4);
});

test('cache dependencies cover capability descriptions even when Plan IDs match', async () => {
  const { jobKeys: _keys, ...custom } = trace;
  for (const jobKeys of [undefined, ['trace', 'code'] as const]) {
    const app = planner({
      ...custom,
      ...(jobKeys === undefined ? {} : { jobKeys }),
      describe: ({ job }) => ({
        'trace.capture': { origin: 'emulated', coverage: 'code' in job && job.code === 'a' ? 'constant' : 'partial' },
      }),
    });
    const request = { profile: 'chrome-mac', job: { kind: 'run' as const, code: 'a', trace: true } };
    const first = await app.inspect(request);
    const second = await app.inspect({ ...request, job: { ...request.job, code: 'b' } });
    assert.equal(first.plan.id, second.plan.id);
    assert.notEqual(first.capabilities.hash, second.capabilities.hash);
    assert.equal(first.capabilities.entries['trace.capture']?.coverage, 'constant');
    assert.equal(second.capabilities.entries['trace.capture']?.coverage, 'partial');
    if (jobKeys) {
      assert.strictEqual(await app.inspect({ ...request, job: { ...request.job, timeout: 100 } }), first);
    }
  }
});
