import assert from 'node:assert/strict';
import { once } from 'node:events';
import http, { type IncomingHttpHeaders } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { startServer } from '../../src/v2/http/server.js';

const profilesRoot = path.resolve('profiles');
const probePath = path.resolve('resources/v2/probe.js');

interface Response {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

function request(
  port: number,
  options: { readonly method?: string; readonly path?: string; readonly body?: unknown; readonly raw?: string } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const payload = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: options.method ?? 'GET',
      path: options.path ?? '/',
      headers: payload === undefined ? undefined : {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: text ? JSON.parse(text) as unknown : undefined,
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

function options(overrides: { readonly maxQueue?: number; readonly maxBodyBytes?: number } = {}) {
  return {
    port: 0,
    profilesRoot,
    probePath,
    size: 1,
    timeoutMs: 5_000,
    maxQueue: overrides.maxQueue ?? 1,
    ...(overrides.maxBodyBytes === undefined ? {} : { maxBodyBytes: overrides.maxBodyBytes }),
    capture: { deadlineMs: 50, pollMs: 5, maxPosts: 1 },
  };
}

test('HTTP exposes the common TaskRequest/Result contract on loopback', async () => {
  const handle = startServer(options());
  try {
    await once(handle.server, 'listening');
    const address = handle.server.address();
    assert.ok(address && typeof address === 'object');
    assert.equal(address.address, '127.0.0.1');
    const port = address.port;

    const run = await request(port, {
      method: 'POST',
      path: '/run',
      body: {
        profile: 'android-webview-v138',
        job: { kind: 'run', code: '({ answer: 6 * 7 })' },
      },
    });
    assert.equal(run.status, 200);
    assert.equal(run.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal((run.body as { ok?: boolean }).ok, true);
    assert.deepEqual((run.body as { value?: unknown }).value, { answer: 42 });

    const profiles = await request(port, { path: '/profiles' });
    assert.equal(profiles.status, 200);
    assert.ok((profiles.body as string[]).includes('android-webview-v138'));

    const mismatch = await request(port, {
      method: 'POST',
      path: '/capture',
      body: { profile: 'android-webview-v138', job: { kind: 'run', code: '1' } },
    });
    assert.equal(mismatch.status, 400);
    assert.equal((mismatch.body as { error?: { code?: string } }).error?.code, 'BAD_ROUTE_KIND');

    const malformed = await request(port, { method: 'POST', path: '/run', raw: '{' });
    assert.equal(malformed.status, 400);
    assert.equal((malformed.body as { error?: { code?: string } }).error?.code, 'BAD_JSON');

    const missing = await request(port, { path: '/not-found' });
    assert.equal(missing.status, 404);
    assert.equal((missing.body as { ok?: boolean }).ok, false);
  } finally {
    await handle.close();
    await handle.close();
  }

  await assert.rejects(
    handle.executor.run({ profile: 'android-webview-v138', job: { kind: 'run', code: '1' } }),
    /destroy|closed/i,
  );
});

test('HTTP bounds request bodies and maps executor backpressure to 503', async () => {
  const limited = startServer(options({ maxBodyBytes: 64 }));
  try {
    await once(limited.server, 'listening');
    const oversized = await request(portOf(limited.server), {
      method: 'POST',
      path: '/run',
      body: {
        profile: 'android-webview-v138',
        job: { kind: 'run', code: 'x'.repeat(128) },
      },
    });
    assert.equal(oversized.status, 413);
    assert.equal((oversized.body as { error?: { code?: string } }).error?.code, 'BODY_TOO_LARGE');
  } finally {
    await limited.close();
  }

  const saturated = startServer(options({ maxQueue: 0 }));
  try {
    await once(saturated.server, 'listening');
    const running = saturated.executor.run({
      profile: 'android-webview-v138',
      job: { kind: 'run', code: 'while (true) {}', timeout: 100 },
    });
    assert.equal(saturated.executor.stats.active, 1);
    const overloaded = await request(portOf(saturated.server), {
      method: 'POST',
      path: '/run',
      body: { profile: 'android-webview-v138', job: { kind: 'run', code: '42' } },
    });
    assert.equal(overloaded.status, 503);
    assert.equal((overloaded.body as { error?: { code?: string } }).error?.code, 'ERR_MIMIC_QUEUE_FULL');
    await running;
  } finally {
    await saturated.close();
  }
});

test('HTTP destroys workers when listen fails', async () => {
  const blocker = http.createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  const blockedPort = portOf(blocker);
  const failed = startServer({ ...options(), port: blockedPort });
  try {
    const [error] = await once(failed.server, 'error');
    assert.equal((error as NodeJS.ErrnoException).code, 'EADDRINUSE');
    await failed.close();
    await assert.rejects(
      failed.executor.run({ profile: 'android-webview-v138', job: { kind: 'run', code: '1' } }),
      /destroy|closed/i,
    );
  } finally {
    await failed.close();
    await new Promise<void>((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));
  }
});
