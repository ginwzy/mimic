import assert from 'node:assert/strict';
import fixture from '../harness/oracles/v1.json' with { type: 'json' };
import { collectOracle, oracleContract } from './v1-oracle.js';

const oracle = await collectOracle();

assert.equal(oracle.schema, 1);
assert.equal(oracle.source.commit, '83624a22425c9178ff714d5ca90b332edc70dcf6');
assert.deepEqual(oracle.source.artifacts, {
  'harness/probe.js': '4e77b6644b66ee48dc9fba8828e727b455af84d73c95ac8f90130b2d407b7f1c',
  'harness/baselines/android-webview-v138.json': 'bcd3ffb7b184eb61ab23827c1a6de256def5b3f4eb33b4bbbb9b01b7cc01bea5',
  'harness/baselines/linux-chrome-v143.json': '8bb471bc084776b3988ef08d73d10ba0eeea6d19d3af061133b3a91c1f6e6d1d',
  'harness/baselines/macos-chrome-v148.json': '1f747c9d2d4c0964f78e59014e7acef9c4b6fa506d5809857f741a624248f105',
  'harness/baselines/macos-chrome-v149.json': '7d1c22a4af2c78df674f8268eead5fad0ee4c19855a486a45fb08aada415800d',
});
assert.equal(oracle.inventory.profiles, 1012);
assert.deepEqual(oracle.inventory.baselines, [
  'android-webview-v138',
  'linux-chrome-v143',
  'macos-chrome-v148',
  'macos-chrome-v149',
]);

assert.deepEqual(
  oracle.structure.map(({ profile, baseline, budget }) => ({ profile, baseline, budget })),
  [
    { profile: 'chrome-mac', baseline: 'macos-chrome-v148', budget: { extra: 0, tell: 1, missing: 7 } },
    { profile: 'macos-chrome-v148', baseline: 'macos-chrome-v148', budget: { extra: 0, tell: 0, missing: 7 } },
    { profile: 'macos-chrome-v149', baseline: 'macos-chrome-v149', budget: { extra: 0, tell: 0, missing: 8 } },
    { profile: 'android-webview-v138', baseline: 'android-webview-v138', budget: { extra: 0, tell: 0, missing: 0 } },
    { profile: 'linux-chrome', baseline: 'linux-chrome-v143', budget: { extra: 0, tell: 0, missing: 0 } },
  ],
);
for (const item of oracle.structure) {
  assert.ok(item.actual.extra <= item.budget.extra, `${item.profile}:EXTRA 超预算`);
  assert.ok(item.actual.tell <= item.budget.tell, `${item.profile}:TELL 超预算`);
  assert.ok(item.actual.missing <= item.budget.missing, `${item.profile}:MISSING 超预算`);
}

assert.equal(oracle.behavior.chrome.userAgent.includes('Chrome/131'), true);
assert.equal(oracle.behavior.chrome.hasChrome, true);
assert.equal(oracle.behavior.webview.hasChrome, false);
assert.equal(oracle.behavior.webview.maxTouchPoints, 5);
assert.deepEqual(oracle.execution.run, { ok: true, value: 2, missing: [] });
assert.equal(oracle.execution.throw.ok, false);
assert.equal(oracle.execution.throw.error, 'oracle boom');
assert.equal(oracle.execution.timeout.ok, false);
assert.match(oracle.execution.timeout.error, /timed out/i);
assert.deepEqual(oracle.execution.trace.missing, ['OracleMissing']);
assert.equal(oracle.execution.trace.dynamicCode, 1);
assert.equal(oracle.execution.encode.value, '[unserializable: [object Window]]');
assert.equal(oracle.execution.capture.syncCaptured, true);
assert.equal(oracle.execution.capture.first, 'sync');
assert.deepEqual(oracle.execution.capture.segments, {
  sync: 'xhr',
  load: 'xhr',
  beacon: 'beacon',
  fetch: 'fetch',
  timer: 'xhr',
});
assert.deepEqual(oracleContract(oracle), fixture);

console.log('v1 oracle: ok');
