import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REQUESTED_JSDOM_VERSION } from '../src/node/metadata.js';

const root = process.cwd();
const production = path.join(root, 'dist');
const tests = path.join(root, 'build/test');

async function filesUnder(directory: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else output.push(path.relative(directory, absolute));
    }
  };
  await visit(directory);
  return output.sort();
}

function build(mode: 'production' | 'test', output?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/build.js', mode], {
      cwd: root,
      env: { ...process.env, ...(output === undefined ? {} : { MIMIC_BUILD_OUTPUT: output }) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`build ${mode} failed (${code ?? signal}):\n${stdout}${stderr}`));
    });
  });
}

test('production and test builds stay isolated', async () => {
  const productionFiles = await filesUnder(production);
  const testFiles = await filesUnder(tests);

  assert.ok(productionFiles.includes('src/index.js'));
  assert.notEqual((await fs.stat(path.join(production, 'src/cli.js'))).mode & 0o111, 0);
  assert.ok(productionFiles.includes('assets/profiles/chrome-mac.json'));
  assert.ok(productionFiles.includes('assets/shapes/chromium/chrome/macos/desktop/148.json'));
  assert.ok(productionFiles.includes('assets/baselines/macos-chrome-v148.json'));
  assert.ok(productionFiles.includes('assets/probe.js'));
  assert.equal(productionFiles.some((file) => file.startsWith('test/')), false);
  assert.equal(productionFiles.some((file) => file.endsWith('.test.js')), false);
  assert.equal(productionFiles.includes('package.json'), false);
  assert.ok(testFiles.includes('test/build.test.js'));
  assert.ok(testFiles.includes('src/index.js'));
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
    dependencies?: { jsdom?: string };
  };
  assert.equal(REQUESTED_JSDOM_VERSION, packageJson.dependencies?.jsdom);
});

test('production build removes stale target files before compiling', async (t) => {
  const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'mimic-build-'));
  t.after(() => fs.rm(isolated, { recursive: true, force: true }));
  const stale = path.join(isolated, 'stale-output');
  await fs.writeFile(stale, 'stale');
  await build('production', isolated);
  await assert.rejects(fs.access(stale));
  assert.equal((await filesUnder(isolated)).some((file) => file.startsWith('test/')), false);
});
