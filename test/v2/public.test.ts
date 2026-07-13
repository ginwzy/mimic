import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as advanced from '../../src/v2/advanced.js';
import * as httpApi from '../../src/v2/http/public.js';
import * as publicApi from '../../src/v2/public.js';

function child(cwd: string, source: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    childProcess.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    childProcess.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    childProcess.on('error', reject);
    childProcess.on('close', (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

test('public entry is narrow while advanced and HTTP stay explicit', () => {
  assert.deepEqual(Object.keys(publicApi).sort(), ['MimicError', 'createMimic']);
  assert.equal(typeof advanced.Application, 'function');
  assert.equal(typeof advanced.Catalog, 'function');
  assert.equal(typeof advanced.JsdomEngine, 'function');
  assert.equal(typeof advanced.WorkerExecutor, 'function');
  assert.equal(typeof httpApi.startServer, 'function');
});

test('public client is a runtime facade over only the stable SDK methods', async () => {
  const mimic = publicApi.createMimic({ size: 1, timeoutMs: 5_000 });
  try {
    assert.deepEqual(Object.keys(mimic).sort(), ['capture', 'close', 'list', 'plan', 'run']);
    assert.equal('probe' in mimic, false);
    assert.equal('diagnose' in mimic, false);
    assert.equal('executor' in mimic, false);
  } finally {
    await mimic.close();
  }
});

test('zero-config public SDK resolves packaged assets outside the consumer cwd', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'mimic-v2-public-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const entry = new URL('../../src/v2/public.js', import.meta.url).href;
  const run = await child(cwd, `
    import { createMimic } from ${JSON.stringify(entry)};
    const mimic = createMimic({ size: 1, timeoutMs: 5000 });
    try {
      const result = await mimic.run({ kind: 'run', code: 'navigator.userAgent' });
      console.log(JSON.stringify(result));
    } finally {
      await mimic.close();
    }
  `);
  assert.equal(run.code, 0, run.stderr);
  const result = JSON.parse(run.stdout) as { ok?: boolean; value?: unknown };
  assert.equal(result.ok, true);
  assert.equal(typeof result.value, 'string');
});
