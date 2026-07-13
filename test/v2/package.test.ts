import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function command(
  commandName: string,
  args: string[],
  cwd = root,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${commandName} failed (${code ?? signal}):${stdout}${stderr}`));
    });
  });
}

test('npm tarball exposes v2 by default with explicit advanced, HTTP, and legacy entries', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'mimic-v2-package-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const packed = await command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], root, {
    ...process.env,
    npm_config_cache: path.join(temp, 'npm-cache'),
  });
  const jsonStart = Math.max(0, packed.stdout.lastIndexOf('\n[') + 1);
  const report = JSON.parse(packed.stdout.slice(jsonStart)) as Array<{ filename: string; files: Array<{ path: string }> }>;
  assert.equal(report.length, 1);
  const names = new Set(report[0]!.files.map((file) => file.path));
  for (const expected of [
    'build/v2/src/v2/public.js',
    'build/v2/src/v2/public.d.ts',
    'build/v2/src/v2/advanced.js',
    'build/v2/src/v2/http/public.js',
    'build/v2/src/v2/cli.js',
    'build/v2/src/v2/executor/worker.js',
    'build/v2/assets/profiles/chrome-mac.json',
    'build/v2/assets/shapes/manifest.json',
    'build/v2/assets/baselines/macos-chrome-v148.json',
    'build/v2/assets/probe.js',
    'entry/index.js',
    'types/legacy.d.ts',
    'docs/v2-usage.md',
  ]) assert.ok(names.has(expected), `tarball missing ${expected}`);
  assert.equal([...names].some((name) => name.includes('/test/') || name.endsWith('.test.js')), false);

  const unpacked = path.join(temp, 'unpacked');
  await mkdir(unpacked);
  await command('tar', ['-xzf', path.join(temp, report[0]!.filename), '-C', unpacked]);
  const packageRoot = path.join(unpacked, 'package');
  await symlink(path.join(root, 'node_modules'), path.join(packageRoot, 'node_modules'), 'dir');
  const consumer = path.join(temp, 'consumer');
  await mkdir(path.join(consumer, 'node_modules'), { recursive: true });
  await symlink(packageRoot, path.join(consumer, 'node_modules/mimic'), 'dir');
  await symlink(path.join(root, 'node_modules/@types'), path.join(consumer, 'node_modules/@types'), 'dir');
  await mkdir(path.join(consumer, 'node_modules/.bin'));
  await symlink('../mimic/build/v2/src/v2/cli.js', path.join(consumer, 'node_modules/.bin/mimic'));
  const run = await command(process.execPath, ['--input-type=module', '-e', `
    import { createMimic } from 'mimic';
    import * as advanced from 'mimic/advanced';
    import * as http from 'mimic/http';
    import * as legacy from 'mimic/legacy';
    const realm = await legacy.Realm.create({ profile: 'chrome-mac' });
    const legacyResult = realm.run('1 + 1');
    realm.dispose();
    const mimic = createMimic({ size: 1, timeoutMs: 5000 });
    try {
      const result = await mimic.run({ kind: 'run', code: 'navigator.userAgent' });
      console.log(JSON.stringify({
        ok: result.ok,
        advanced: typeof advanced.JsdomEngine,
        http: typeof http.startServer,
        legacy: typeof legacy.Realm,
        legacyOk: legacyResult.ok && legacyResult.value === 2,
      }));
    } finally {
      await mimic.close();
    }
  `], consumer);
  assert.deepEqual(JSON.parse(run.stdout), {
    ok: true,
    advanced: 'function',
    http: 'function',
    legacy: 'function',
    legacyOk: true,
  });

  const privateImport = await command(process.execPath, ['--input-type=module', '-e', `
    try {
      await import('mimic/build/v2/src/v2/index.js');
      console.log('unexpected');
    } catch (error) {
      console.log(error.code);
    }
  `], consumer);
  assert.equal(privateImport.stdout.trim(), 'ERR_PACKAGE_PATH_NOT_EXPORTED');

  const bin = await command(path.join(consumer, 'node_modules/.bin/mimic'), ['list', 'profiles'], consumer);
  assert.ok((JSON.parse(bin.stdout) as string[]).includes('chrome-mac'));

  await writeFile(path.join(consumer, 'index.ts'), `
    import { createMimic, type RunJob } from 'mimic';
    import { JsdomEngine } from 'mimic/advanced';
    import { startServer } from 'mimic/http';
    import { Realm } from 'mimic/legacy';
    const job: RunJob = { kind: 'run', code: '1 + 1' };
    void createMimic;
    void JsdomEngine;
    void startServer;
    void Realm;
    void job;
  `);
  await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: ['node'],
    },
    include: ['index.ts'],
  }));
  await command(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer);

  const packedPackage = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
    version?: string;
    bin?: Record<string, string>;
  };
  assert.equal(packedPackage.version, '0.2.0');
  assert.equal(packedPackage.bin?.mimic, 'build/v2/src/v2/cli.js');
});
