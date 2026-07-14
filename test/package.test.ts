import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

const RETIRED_SOURCE_PATHS = [
  'entry',
  'core',
  'base',
  'capture',
  'mask',
  'patch',
  'trace',
  'harness',
  'reference/legacy',
  'types/legacy.d.ts',
  'tools/fp-env',
  'smoke.js',
  'scripts/check.js',
  'scripts/test.js',
  'scripts/v1-bench.js',
  'scripts/v1-oracle.js',
] as const;

const RETIRED_VERSION_PATHS = [
  'src/v2',
  'test/v2',
  'resources/v2',
  'build/v2',
  'build/v2-test',
  'scripts/build-v2.js',
  'scripts/generate-v2-shapes.js',
  'scripts/v2-dom-data.ts',
  'tsconfig.v2.json',
  'tsconfig.v2.test.json',
  'docs/v2-usage.md',
  'docs/spec/v2-architecture.md',
] as const;

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

test('retired v1 source surface does not return to the repository', async () => {
  for (const relativePath of RETIRED_SOURCE_PATHS) {
    await assert.rejects(
      access(path.join(root, relativePath)),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
      `repository still contains ${relativePath}`,
    );
  }
});

test('retired implementation version paths do not return to the repository', async () => {
  for (const relativePath of RETIRED_VERSION_PATHS) {
    await assert.rejects(
      access(path.join(root, relativePath)),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
      `repository still contains ${relativePath}`,
    );
  }
});

test('npm tarball exposes only the current public surfaces', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'mimic-package-'));
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
    'dist/src/public.js',
    'dist/src/public.d.ts',
    'dist/src/advanced.js',
    'dist/src/http/public.js',
    'dist/src/cli.js',
    'dist/src/executor/worker.js',
    'dist/assets/profiles/chrome-mac.json',
    'dist/assets/shapes/manifest.json',
    'dist/assets/baselines/macos-chrome-v148.json',
    'dist/assets/probe.js',
    'docs/usage.md',
  ]) assert.ok(names.has(expected), `tarball missing ${expected}`);
  assert.equal([...names].some((name) => name.includes('/test/') || name.endsWith('.test.js')), false);
  for (const prefix of ['entry/', 'core/', 'mask/', 'patch/', 'base/', 'trace/', 'profiles/']) {
    assert.equal([...names].some((name) => name.startsWith(prefix)), false, `tarball contains ${prefix}`);
  }
  assert.equal(names.has('types/legacy.d.ts'), false);

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
  await symlink('../mimic/dist/src/cli.js', path.join(consumer, 'node_modules/.bin/mimic'));
  const run = await command(process.execPath, ['--input-type=module', '-e', `
    import { createMimic } from 'mimic';
    import * as advanced from 'mimic/advanced';
    import * as http from 'mimic/http';
    const mimic = createMimic({ size: 1, timeoutMs: 5000 });
    try {
      const result = await mimic.run({ kind: 'run', code: 'navigator.userAgent' });
      console.log(JSON.stringify({
        ok: result.ok,
        advanced: typeof advanced.JsdomEngine,
        http: typeof http.startServer,
      }));
    } finally {
      await mimic.close();
    }
  `], consumer);
  assert.deepEqual(JSON.parse(run.stdout), {
    ok: true,
    advanced: 'function',
    http: 'function',
  });

  const privateImport = await command(process.execPath, ['--input-type=module', '-e', `
    try {
      await import('mimic/dist/src/index.js');
      console.log('unexpected');
    } catch (error) {
      console.log(error.code);
    }
  `], consumer);
  assert.equal(privateImport.stdout.trim(), 'ERR_PACKAGE_PATH_NOT_EXPORTED');

  const legacyImport = await command(process.execPath, ['--input-type=module', '-e', `
    try {
      await import('mimic/legacy');
      console.log('unexpected');
    } catch (error) {
      console.log(error.code);
    }
  `], consumer);
  assert.equal(legacyImport.stdout.trim(), 'ERR_PACKAGE_PATH_NOT_EXPORTED');

  const bin = await command(path.join(consumer, 'node_modules/.bin/mimic'), ['list', 'profiles'], consumer);
  assert.ok((JSON.parse(bin.stdout) as string[]).includes('chrome-mac'));

  await writeFile(path.join(consumer, 'index.ts'), `
    import { createMimic, type RunJob } from 'mimic';
    import { JsdomEngine } from 'mimic/advanced';
    import { startServer } from 'mimic/http';
    const job: RunJob = { kind: 'run', code: '1 + 1' };
    void createMimic;
    void JsdomEngine;
    void startServer;
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

  await writeFile(path.join(consumer, 'legacy.ts'), `
    import { Realm } from 'mimic/legacy';
    void Realm;
  `);
  await assert.rejects(
    command(process.execPath, [
      path.join(root, 'node_modules/typescript/bin/tsc'),
      '--ignoreConfig', '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
      '--target', 'ES2022', '--types', 'node', 'legacy.ts',
    ], consumer),
    /TS2307/,
  );

  const packedPackage = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
    version?: string;
    bin?: Record<string, string>;
    exports?: Record<string, unknown>;
    scripts?: Record<string, string>;
  };
  assert.equal(packedPackage.version, '0.3.0');
  assert.equal(packedPackage.bin?.mimic, 'dist/src/cli.js');
  assert.equal(Object.hasOwn(packedPackage.exports ?? {}, './legacy'), false);
  assert.equal(Object.keys(packedPackage.scripts ?? {}).some((name) => name.includes('v2')), false);
});
