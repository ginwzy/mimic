import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import http, { type IncomingHttpHeaders } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_COLLECT_MAX_BODY_BYTES,
  DEFAULT_COLLECT_PORT,
  startCollectServer,
} from '../../src/v2/collect/server.js';

interface Response {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly text: string;
  readonly body?: unknown;
}

interface RequestOptions {
  readonly method?: string;
  readonly path?: string;
  readonly body?: unknown;
  readonly raw?: string;
  readonly contentType?: string;
}

function request(port: number, options: RequestOptions = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const payload = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const headers = payload === undefined ? undefined : {
      'content-type': options.contentType ?? 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
    };
    const outgoing = http.request({
      host: '127.0.0.1',
      port,
      method: options.method ?? 'GET',
      path: options.path ?? '/',
      ...(headers === undefined ? {} : { headers }),
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: unknown;
        if (incoming.headers['content-type']?.startsWith('application/json') && text) {
          try {
            body = JSON.parse(text) as unknown;
          } catch (error) {
            reject(error);
            return;
          }
        }
        resolve({
          status: incoming.statusCode ?? 0,
          headers: incoming.headers,
          text,
          ...(body === undefined ? {} : { body }),
        });
      });
    });
    outgoing.on('error', reject);
    outgoing.end(payload);
  });
}

function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

async function temporaryRoot(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimic-v2-collect-server-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function fixture(): Promise<{ profileRaw: Record<string, unknown>; probeSnapshot: Record<string, unknown> }> {
  const profileRaw = JSON.parse(await readFile(path.resolve('profiles/android-webview-v138.json'), 'utf8')) as {
    meta: Record<string, unknown>;
  } & Record<string, unknown>;
  delete profileRaw.meta.name;
  delete profileRaw.meta.traits;

  const probeSnapshot = JSON.parse(
    await readFile(path.resolve('resources/v2/baselines/android-webview-v138.json'), 'utf8'),
  ) as { meta: Record<string, unknown> } & Record<string, unknown>;
  delete probeSnapshot.meta.profile;
  return { profileRaw, probeSnapshot };
}

test('collect server serves the compiled collectors and one legacy POST creates immutable v2 artifacts', async (t) => {
  const root = await temporaryRoot(t);
  const probePath = path.resolve('resources/v2/probe.js');
  const handle = startCollectServer({ root, probePath, port: 0 });
  try {
    await once(handle.server, 'listening');
    const address = handle.server.address();
    assert.ok(address && typeof address === 'object');
    assert.equal(address.address, '0.0.0.0');
    const port = address.port;

    const page = await request(port);
    assert.equal(page.status, 200);
    assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
    assert.ok(page.text.indexOf('window.__probe__()') < page.text.indexOf('collectIdentity()'));
    assert.match(page.text, /const probeSnapshot = \{ \.\.\.rawProbe, meta: \{ \.\.\.rawMeta, ua: navigator\.userAgent \} \}/);
    assert.doesNotMatch(page.text, /probeSnapshot\.meta\s*=/);

    const identity = await request(port, { path: '/identity.js' });
    const compiledIdentity = await readFile(new URL('../../src/v2/collect/browser.js', import.meta.url), 'utf8');
    assert.equal(identity.status, 200);
    assert.equal(identity.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(identity.text, compiledIdentity);
    assert.match(identity.text, /export default collectIdentity/);

    const probe = await request(port, { path: '/probe.js' });
    assert.equal(probe.status, 200);
    assert.equal(probe.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(probe.text, await readFile(probePath, 'utf8'));

    const legacy = await request(port, { method: 'POST', path: '/collect', body: await fixture() });
    assert.equal(legacy.status, 201);
    assert.equal(legacy.headers['content-type'], 'application/json; charset=utf-8');
    const receipt = legacy.body as {
      capture: { hash: string };
      artifacts?: { profile: { id: string }; shape: { id: string } };
      files: { capture: string; profile?: string; shape?: string; catalog?: string };
    };
    assert.ok(receipt.artifacts);
    assert.equal((await readdir(path.join(root, 'captures'))).length, 1);
    assert.equal((await readdir(path.join(root, 'profiles'))).length, 1);
    assert.equal((await readdir(path.join(root, 'shapes'))).length, 1);
    assert.equal(typeof receipt.files.catalog, 'string');
    assert.equal(typeof receipt.files.profile, 'string');
    assert.equal(typeof receipt.files.shape, 'string');
    const captureBytes = await readFile(receipt.files.capture, 'utf8');

    const schema2 = await request(port, { method: 'POST', path: '/collect', body: receipt.capture });
    assert.equal(schema2.status, 201);
    const repeated = schema2.body as { capture: { hash: string }; files: { capture: string } };
    assert.equal(repeated.capture.hash, receipt.capture.hash);
    assert.equal(await readFile(repeated.files.capture, 'utf8'), captureBytes);
    assert.equal((await readdir(path.join(root, 'captures'))).length, 1);

    const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8')) as { shapes?: unknown[] };
    assert.equal(catalog.shapes?.length, 1);
  } finally {
    await handle.close();
    await handle.close();
  }
  assert.equal(handle.server.listening, false);
});

test('collect server strictly bounds JSON requests, routes, and repeated shutdown', async (t) => {
  assert.equal(DEFAULT_COLLECT_PORT, 8970);
  assert.equal(DEFAULT_COLLECT_MAX_BODY_BYTES, 32 * 1024 * 1024);

  const root = await temporaryRoot(t);
  const handle = startCollectServer({
    root,
    probePath: path.resolve('resources/v2/probe.js'),
    port: 0,
    maxBodyBytes: 64,
  });
  try {
    await once(handle.server, 'listening');
    const port = portOf(handle.server);

    const oversized = await request(port, {
      method: 'POST',
      path: '/collect',
      body: { profileRaw: { value: 'x'.repeat(80) }, probeSnapshot: null },
    });
    assert.equal(oversized.status, 413);
    assert.equal((oversized.body as { error?: { code?: string } }).error?.code, 'BODY_TOO_LARGE');

    const malformed = await request(port, { method: 'POST', path: '/collect', raw: '{' });
    assert.equal(malformed.status, 400);
    assert.equal((malformed.body as { error?: { code?: string } }).error?.code, 'BAD_JSON');

    const wrongMedia = await request(port, {
      method: 'POST',
      path: '/collect',
      raw: '{}',
      contentType: 'text/plain',
    });
    assert.equal(wrongMedia.status, 415);
    assert.equal((wrongMedia.body as { error?: { code?: string } }).error?.code, 'UNSUPPORTED_MEDIA_TYPE');

    const missing = await request(port, { path: '/missing' });
    assert.equal(missing.status, 404);
    assert.equal((missing.body as { error?: { code?: string } }).error?.code, 'NOT_FOUND');

    const wrongMethod = await request(port, { method: 'PUT', path: '/collect', raw: '{}' });
    assert.equal(wrongMethod.status, 404);
    assert.equal((wrongMethod.body as { error?: { code?: string } }).error?.code, 'NOT_FOUND');
  } finally {
    await Promise.all([handle.close(), handle.close()]);
  }
  assert.equal(handle.server.listening, false);
});
