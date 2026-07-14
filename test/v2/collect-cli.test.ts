import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCli, type CliIo, type CliServerHandle } from '../../src/v2/cli.js';

test('CLI collect starts the dedicated collector with explicit storage and closes cleanly', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimic-v2-collect-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stdout: string[] = [];
  const stderr: string[] = [];
  let handle: CliServerHandle | undefined;
  const io: CliIo = {
    cwd: process.cwd(),
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    started: (value) => { handle = value; },
  };

  const code = await runCli([
    'collect',
    '--root', root,
    '--probe', path.resolve('resources/v2/probe.js'),
    '--host', '127.0.0.1',
    '--port', '0',
  ], io);

  assert.equal(code, 0);
  assert.deepEqual(stderr, []);
  assert.ok(handle);
  const output = JSON.parse(stdout[0] ?? '') as { ok?: boolean; url?: string; root?: string };
  assert.equal(output.ok, true);
  assert.match(output.url ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(output.root, root);
  await handle.close();
  assert.equal(handle.server.listening, false);
});
