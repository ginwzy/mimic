import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Catalog, compile, JsdomEngine, LegacyProfiles, parseJob } from '../../src/v2/index.js';
import { drivers, features } from '../../src/v2/features/index.js';
import { diff, summarize, type ProbeSnapshot } from '../../src/v2/probe/diff.js';

interface Budget {
  TELL: number;
  EXTRA: number;
  MISSING: number;
}

interface Pair {
  profile: string;
  baseline: string;
  budget: Budget;
}

const pairs: readonly Pair[] = [
  { profile: 'chrome-mac', baseline: 'macos-chrome-v148', budget: { TELL: 1, EXTRA: 0, MISSING: 7 } },
  { profile: 'macos-chrome-v148', baseline: 'macos-chrome-v148', budget: { TELL: 0, EXTRA: 0, MISSING: 7 } },
  { profile: 'macos-chrome-v149', baseline: 'macos-chrome-v149', budget: { TELL: 0, EXTRA: 0, MISSING: 8 } },
  { profile: 'android-webview-v138', baseline: 'android-webview-v138', budget: { TELL: 0, EXTRA: 0, MISSING: 0 } },
  { profile: 'linux-chrome', baseline: 'linux-chrome-v143', budget: { TELL: 0, EXTRA: 0, MISSING: 0 } },
];

const profiles = new LegacyProfiles(path.resolve('profiles'));
const probe = readFileSync(path.resolve('harness/probe.js'), 'utf8');

function fixture(value: unknown): ProbeSnapshot {
  return value as ProbeSnapshot;
}

test('probe diff keeps tells, coverage gaps, leaks, and source notes distinct', () => {
  const baseline = fixture({
    meta: { complete: true },
    targets: [
      {
        id: 'window.call', category: 'function', t1: true, resolved: true,
        fn: { name: 'call', length: 1, toStringNative: true, toStringSrc: '' },
      },
      {
        id: 'navigator', category: 'object', resolved: true,
        ownKeys: ['kept', 'missing'], symbolKeys: [],
        keys: {
          kept: { type: 'data', flags: { writable: true, enumerable: true, configurable: true }, valueType: 'string' },
          missing: { type: 'data', flags: { writable: true, enumerable: true, configurable: true }, valueType: 'string' },
        },
      },
      { id: 'window.absent', category: 'object', resolved: false },
    ],
  });
  const mimic = fixture({
    targets: [
      {
        id: 'window.call', category: 'function', t1: true, resolved: true,
        fn: { name: 'call', length: 2, toStringNative: false, toStringSrc: 'function call() {}' },
      },
      {
        id: 'navigator', category: 'object', resolved: true,
        ownKeys: ['kept', 'extra'], symbolKeys: ['Symbol(impl)'],
        keys: {
          kept: { type: 'data', flags: { writable: true, enumerable: true, configurable: true }, valueType: 'string' },
          extra: { type: 'data', flags: { writable: true, enumerable: true, configurable: true }, valueType: 'string' },
        },
      },
      { id: 'window.absent', category: 'object', resolved: true, keys: {} },
    ],
  });

  const entries = diff(baseline, mimic);
  const all = summarize(entries);
  assert.deepEqual(all.counts, { TELL: 2, MISSING: 1, EXTRA: 3, INFO: 1 });
  assert.equal(all.blockers.length, 4);
  assert.equal(all.gatePass, false);
  assert.equal(entries.find((entry) => entry.field === 'symbolKey')?.severity, 'warn');

  const t1 = summarize(entries, { t1Only: true });
  assert.deepEqual(t1.counts, { TELL: 2, MISSING: 0, EXTRA: 0, INFO: 1 });
  assert.equal(t1.blockers.length, 2);
});

async function snapshot(id: string): Promise<ProbeSnapshot> {
  const imported = await profiles.load(id);
  const engine = new JsdomEngine();
  const plan = compile({
    profile: imported.profile,
    catalog: Catalog.create('oracle', [imported.shape], features),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: Object.keys(drivers),
  });
  const runtime = engine.open(plan, drivers);
  try {
    const result = runtime.run(`${probe}\n;JSON.stringify(window.__probe__());`);
    assert.equal(result.ok, true, result.ok ? undefined : `${result.error}\n${result.stack || ''}`);
    return JSON.parse(String(result.value)) as ProbeSnapshot;
  } finally {
    runtime.dispose();
    assert.equal(engine.active, 0);
  }
}

for (const pair of pairs) {
  test(`v2 stays within the P0 oracle budget for ${pair.profile} x ${pair.baseline}`, async () => {
    const baseline = JSON.parse(readFileSync(path.resolve(`harness/baselines/${pair.baseline}.json`), 'utf8')) as ProbeSnapshot;
    const actual = summarize(diff(baseline, await snapshot(pair.profile))).counts;
    for (const bucket of ['TELL', 'EXTRA', 'MISSING'] as const) {
      assert.ok(
        actual[bucket] <= pair.budget[bucket],
        `${bucket} ${actual[bucket]} exceeds ${pair.budget[bucket]}`,
      );
    }
  });
}
