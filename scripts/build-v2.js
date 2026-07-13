#!/usr/bin/env node
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modes = {
  production: { config: 'tsconfig.v2.json', output: 'build/v2' },
  test: { config: 'tsconfig.v2.test.json', output: 'build/v2-test' },
};
const mode = process.argv[2] ?? 'production';
const selected = modes[mode];
if (!selected) {
  console.error('usage: node scripts/build-v2.js [production|test]');
  process.exit(2);
}

const output = path.resolve(process.env.MIMIC_BUILD_OUTPUT ?? path.join(root, selected.output));
rmSync(output, { recursive: true, force: true });
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
const compiled = spawnSync(process.execPath, [
  tsc,
  '-p', selected.config,
  ...(process.env.MIMIC_BUILD_OUTPUT === undefined ? [] : ['--outDir', output]),
], {
  cwd: root,
  stdio: 'inherit',
});
if (compiled.error) throw compiled.error;
if (compiled.status !== 0) process.exit(compiled.status ?? 1);
chmodSync(path.join(output, 'src/v2/cli.js'), 0o755);

const assets = path.join(output, 'assets');
mkdirSync(assets, { recursive: true });
cpSync(path.join(root, 'profiles'), path.join(assets, 'profiles'), { recursive: true });
cpSync(path.join(root, 'resources/v2/shapes'), path.join(assets, 'shapes'), { recursive: true });
cpSync(path.join(root, 'harness/baselines'), path.join(assets, 'baselines'), { recursive: true });
copyFileSync(path.join(root, 'harness/probe.js'), path.join(assets, 'probe.js'));

if (mode === 'production' && existsSync(path.join(output, 'test'))) {
  console.error('production v2 build unexpectedly contains test output');
  process.exit(1);
}
