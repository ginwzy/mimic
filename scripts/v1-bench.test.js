import assert from 'node:assert/strict';
import { benchmarkV1 } from './v1-bench.js';

const report = await benchmarkV1({
  iterations: 2,
  warmup: 1,
  rounds: 1,
  poolSize: 1,
  profiles: ['chrome-mac'],
});

assert.equal(report.schema, 1);
assert.equal(report.config.iterations, 2);
assert.equal(report.config.warmup, 1);
assert.equal(report.config.rounds, 1);
assert.equal(report.config.poolSize, 1);
assert.deepEqual(report.config.profiles, ['chrome-mac']);
assert.equal(report.source.commit, '83624a22425c9178ff714d5ca90b332edc70dcf6');
assert.equal(report.source.jsdom, '29.1.1');
assert.ok(report.runtime.cpuModel.length > 0);
assert.ok(report.runtime.kernel.length > 0);
assert.ok(report.profiles['chrome-mac'].cycle.createMs.median > 0);
assert.ok(report.profiles['chrome-mac'].cycle.runMs.median >= 0);
assert.ok(report.profiles['chrome-mac'].cycle.disposeMs.median >= 0);
assert.ok(report.profiles['chrome-mac'].cycle.throughputPerSecond > 0);
assert.ok(report.profiles['chrome-mac'].pool.coldStartMs > 0);
assert.ok(report.profiles['chrome-mac'].pool.warmThroughputPerSecond > 0);
assert.ok(report.memory.rssStart > 0);
assert.ok(report.memory.rssMax >= report.memory.rssStart);

console.log('v1 benchmark contract: ok');
