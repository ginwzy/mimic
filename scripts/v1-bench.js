#!/usr/bin/env node
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Realm } from '../core/realm.js';
import { RealmPool } from '../entry/pool.js';
import packageJSON from '../package.json' with { type: 'json' };

const SOURCE_COMMIT = '83624a22425c9178ff714d5ca90b332edc70dcf6';

const positiveInt = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

const nonNegativeInt = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
};

function percentile(values, fraction) {
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
  return sorted[index];
}

const summary = (values) => ({
  median: percentile(values, 0.5),
  p95: percentile(values, 0.95),
});

async function cycle(profile) {
  const createStart = performance.now();
  const realm = await Realm.create({ profile });
  const createMs = performance.now() - createStart;
  try {
    const runStart = performance.now();
    const result = realm.run('1 + 1');
    const runMs = performance.now() - runStart;
    if (!result.ok || result.value !== 2) throw new Error(`Realm benchmark 结果不正确:${profile}`);
    const disposeStart = performance.now();
    realm.dispose();
    return { createMs, runMs, disposeMs: performance.now() - disposeStart };
  } catch (error) {
    realm.dispose();
    throw error;
  }
}

async function measureProfile(profile, { iterations, warmup, rounds, poolSize }, sampleMemory) {
  for (let i = 0; i < warmup; i++) await cycle(profile);

  const createMs = [];
  const runMs = [];
  const disposeMs = [];
  const cycleThroughput = [];
  const poolColdStart = [];
  const poolThroughput = [];

  for (let round = 0; round < rounds; round++) {
    const roundStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      const measured = await cycle(profile);
      createMs.push(measured.createMs);
      runMs.push(measured.runMs);
      disposeMs.push(measured.disposeMs);
      sampleMemory();
    }
    cycleThroughput.push(iterations / ((performance.now() - roundStart) / 1000));

    const poolStart = performance.now();
    const pool = new RealmPool({ size: poolSize, maxQueue: Math.max(iterations, poolSize) });
    try {
      const first = await pool.run({ profile, code: '1 + 1' });
      if (!first.ok || first.value !== 2) throw new Error(`Pool cold benchmark 结果不正确:${profile}`);
      poolColdStart.push(performance.now() - poolStart);

      await Promise.all(Array.from({ length: Math.max(0, poolSize - 1) }, () => pool.run({ profile, code: '1 + 1' })));
      const warmStart = performance.now();
      const results = await Promise.all(Array.from({ length: iterations }, () => pool.run({ profile, code: '1 + 1' })));
      poolThroughput.push(iterations / ((performance.now() - warmStart) / 1000));
      if (results.some((result) => !result.ok || result.value !== 2)) throw new Error(`Pool benchmark 结果不正确:${profile}`);
      sampleMemory();
    } finally {
      await pool.destroy();
    }
  }

  return {
    cycle: {
      createMs: summary(createMs),
      runMs: summary(runMs),
      disposeMs: summary(disposeMs),
      throughputPerSecond: percentile(cycleThroughput, 0.5),
    },
    pool: {
      coldStartMs: percentile(poolColdStart, 0.5),
      warmThroughputPerSecond: percentile(poolThroughput, 0.5),
    },
  };
}

export async function benchmarkV1({
  iterations = 30,
  warmup = 5,
  rounds = 3,
  poolSize = Math.max(1, Math.min(4, os.cpus().length - 1)),
  profiles = ['chrome-mac', 'android-webview-v138'],
} = {}) {
  iterations = positiveInt(iterations, 30);
  warmup = nonNegativeInt(warmup, 5);
  rounds = positiveInt(rounds, 3);
  poolSize = positiveInt(poolSize, 1);
  profiles = Array.isArray(profiles) && profiles.length ? profiles.map(String) : ['chrome-mac'];

  const memoryStart = process.memoryUsage();
  let rssMax = memoryStart.rss;
  const sampleMemory = () => { rssMax = Math.max(rssMax, process.memoryUsage().rss); };
  const sampler = setInterval(sampleMemory, 5);
  const measuredProfiles = {};
  try {
    for (const profile of profiles) {
      measuredProfiles[profile] = await measureProfile(profile, { iterations, warmup, rounds, poolSize }, sampleMemory);
    }
  } finally {
    clearInterval(sampler);
    sampleMemory();
  }

  const memoryEnd = process.memoryUsage();
  return {
    schema: 1,
    source: { commit: SOURCE_COMMIT, jsdom: packageJSON.dependencies.jsdom },
    runtime: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      kernel: os.release(),
      cpuModel: os.cpus()[0]?.model || 'unknown',
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
    },
    config: { iterations, warmup, rounds, poolSize, profiles },
    profiles: measuredProfiles,
    memory: {
      rssStart: memoryStart.rss,
      rssEnd: memoryEnd.rss,
      rssMax,
      heapUsedStart: memoryStart.heapUsed,
      heapUsedEnd: memoryEnd.heapUsed,
    },
  };
}

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await benchmarkV1({
    iterations: flag('iterations'),
    warmup: flag('warmup'),
    rounds: flag('rounds'),
    poolSize: flag('pool-size'),
    profiles: flag('profiles')?.split(',').filter(Boolean),
  });
  console.log(JSON.stringify(report, null, 2));
}
