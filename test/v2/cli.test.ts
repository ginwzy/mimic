import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCli, type CliIo } from '../../src/v2/cli.js';
import type { CliServerHandle } from '../../src/v2/cli.js';

const profilesRoot = path.resolve('profiles');
const probePath = path.resolve('resources/v2/probe.js');

function captureIo(cwd = process.cwd()): { readonly io: CliIo; readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    },
  };
}

function common(): string[] {
  return [
    '--profile', 'android-webview-v138',
    '--profiles', profilesRoot,
    '--probe', probePath,
    '--pool-size', '1',
    '--timeout', '5000',
    '--max-queue', '1',
  ];
}

function output(lines: readonly string[]): unknown {
  assert.equal(lines.length, 1);
  return JSON.parse(lines[0] ?? '') as unknown;
}

test('CLI run-like commands read scripts, emit JSON, and close their SDK workers', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mimic-v2-cli-'));
  try {
    const runFile = path.join(temp, 'run.js');
    const captureFile = path.join(temp, 'capture.js');
    const diagnoseFile = path.join(temp, 'diagnose.js');
    await Promise.all([
      fs.writeFile(runFile, '6 * 7'),
      fs.writeFile(captureFile, `navigator.sendBeacon('/collect', 'cli-body')`),
      fs.writeFile(diagnoseFile, `eval('20 + 22')`),
    ]);

    const run = captureIo(temp);
    assert.equal(await runCli(['run', runFile, ...common()], run.io), 0);
    assert.equal((output(run.stdout) as { ok?: boolean; value?: unknown }).value, 42);
    assert.deepEqual(run.stderr, []);

    const capture = captureIo(temp);
    assert.equal(await runCli(['capture', captureFile, ...common()], capture.io), 0);
    assert.equal(
      (output(capture.stdout) as { value?: { captured?: string } }).value?.captured,
      'cli-body',
    );

    const diagnose = captureIo(temp);
    assert.equal(await runCli(['diagnose', diagnoseFile, ...common()], diagnose.io), 0);
    assert.deepEqual(
      (output(diagnose.stdout) as { report?: { trace?: unknown } }).report?.trace,
      { dynamicCode: [{ type: 'eval', code: '20 + 22' }] },
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('CLI probe, plan, and list share profile/profiles/probe configuration', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mimic-v2-cli-'));
  try {
    const script = path.join(temp, 'plan.js');
    await fs.writeFile(script, '21 * 2');

    const probe = captureIo(temp);
    assert.equal(await runCli(['probe', ...common()], probe.io), 0);
    assert.ok(Array.isArray((output(probe.stdout) as { value?: { targets?: unknown[] } }).value?.targets));

    const plan = captureIo(temp);
    assert.equal(await runCli(['plan', script, ...common()], plan.io), 0);
    const planBody = output(plan.stdout) as { task?: string; id?: string };
    assert.equal(planBody.task, 'run');
    assert.equal(typeof planBody.id, 'string');

    const list = captureIo(temp);
    assert.equal(await runCli(['list', 'profiles', ...common()], list.io), 0);
    assert.ok((output(list.stdout) as string[]).includes('android-webview-v138'));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('CLI serve starts the HTTP adapter on an ephemeral port and exposes its handle for shutdown', async () => {
  const cli = captureIo();
  let handle: CliServerHandle | undefined;
  const code = await runCli(['serve', ...common(), '--port', '0'], {
    ...cli.io,
    started: (value) => { handle = value; },
  });
  try {
    assert.equal(code, 0);
    assert.ok(handle);
    const started = output(cli.stdout) as { ok?: boolean; url?: string; executor?: { size?: number } };
    assert.equal(started.ok, true);
    assert.match(started.url ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(started.executor?.size, 1);
  } finally {
    await handle?.close();
  }
});

test('CLI diff emits a machine-readable Result and passes an exact profile baseline', async () => {
  const cli = captureIo();
  const code = await runCli([
    'diff',
    'android-webview-v138',
    '--baseline', 'android-webview-v138',
    ...common(),
  ], cli.io);

  assert.equal(code, 0);
  assert.deepEqual(cli.stderr, []);
  const result = output(cli.stdout) as {
    ok?: boolean;
    plan?: string;
    support?: unknown;
    value?: {
      profile?: string;
      baseline?: string;
      entries?: unknown[];
      summary?: { gatePass?: boolean; counts?: unknown };
    };
  };
  assert.equal(result.ok, true);
  assert.equal(typeof result.plan, 'string');
  assert.equal(typeof result.support, 'object');
  assert.equal(result.value?.profile, 'android-webview-v138');
  assert.match(result.value?.baseline ?? '', /android-webview-v138\.json$/);
  assert.deepEqual(result.value?.entries, []);
  assert.deepEqual(result.value?.summary?.counts, { TELL: 0, MISSING: 0, EXTRA: 0, INFO: 0 });
  assert.equal(result.value?.summary?.gatePass, true);
});

test('CLI diff reports a structural gate failure without losing the successful probe Result', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mimic-v2-cli-diff-'));
  try {
    const baseline = path.join(temp, 'baseline.json');
    await fs.writeFile(baseline, JSON.stringify({
      meta: { complete: true },
      targets: [{
        id: 'window.atob',
        category: 'function',
        resolved: true,
        fn: { name: 'notAtob' },
      }],
    }));

    const cli = captureIo(temp);
    const code = await runCli([
      'diff',
      '--baseline', 'baseline.json',
      '--t1', 'false',
      ...common(),
    ], cli.io);

    assert.equal(code, 1);
    assert.deepEqual(cli.stderr, []);
    const result = output(cli.stdout) as {
      ok?: boolean;
      value?: {
        entries?: { field?: string; bucket?: string }[];
        summary?: { gatePass?: boolean; blockers?: unknown[] };
      };
    };
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.value?.entries?.map(({ field, bucket }) => ({ field, bucket })),
      [{ field: 'fn.name', bucket: 'TELL' }],
    );
    assert.equal(result.value?.summary?.gatePass, false);
    assert.equal(result.value?.summary?.blockers?.length, 1);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('CLI rejects missing scripts and invalid flags as JSON without starting work', async () => {
  const missing = captureIo();
  assert.equal(await runCli(['run', ...common()], missing.io), 1);
  assert.deepEqual(missing.stdout, []);
  assert.match((output(missing.stderr) as { error?: { message?: string } }).error?.message ?? '', /script/i);

  const invalid = captureIo();
  assert.equal(await runCli([
    'probe',
    '--pool-size', '0',
    '--profiles', profilesRoot,
    '--probe', probePath,
  ], invalid.io), 1);
  assert.match((output(invalid.stderr) as { error?: { message?: string } }).error?.message ?? '', /pool-size/);
});

test('CLI diff rejects an empty baseline instead of treating it as a passing gate', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mimic-v2-cli-diff-'));
  try {
    await fs.writeFile(path.join(temp, 'empty.json'), JSON.stringify({ targets: [] }));
    const cli = captureIo(temp);
    assert.equal(await runCli(['diff', '--baseline', 'empty.json', ...common()], cli.io), 1);
    assert.deepEqual(cli.stdout, []);
    assert.match(
      (output(cli.stderr) as { error?: { message?: string } }).error?.message ?? '',
      /at least one Probe target/,
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
