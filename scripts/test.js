#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const tests = [
  'scripts/v1-oracle.test.js',
  'scripts/v1-bench.test.js',
  'harness/test.js',
  'harness/diff-gate.test.js',
  'harness/gen-keyorder.mjs',
  'harness/collection-probe.test.js',
  'capture/test.js',
  'core/session.test.js',
  'patch/webgl.test.js',
  'patch/canvas.test.js',
  'patch/audio.test.js',
  'patch/clock.test.js',
  'patch/chrome.test.js',
  'patch/navigator.test.js',
  'patch/ctoriface.test.js',
  'patch/eventtarget.test.js',
  'patch/domproto.test.js',
  'patch/trace.test.js',
  'entry/pool.test.js',
  'entry/server.test.js',
];

for (const test of tests) {
  const result = spawnSync(process.execPath, [test], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
