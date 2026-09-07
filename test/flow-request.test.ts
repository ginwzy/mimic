import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { Session } from '@zionsssx/freq-js';
import { createRequestClient } from '../flow/client.js';
import { createAnaRequest } from '../flow/suppliers/ana/request.js';
import { FpEnvProfiles } from '../src/profiles/fp-env.js';

async function receiver(t: TestContext) {
  const received: IncomingHttpHeaders[] = [];
  const server = createServer((request, response) => {
    request.resume();
    received.push(request.headers);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.headers));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}`, received };
}

test('flow client can suppress default headers without changing the default or ordered paths', async (t) => {
  const { url } = await receiver(t);
  const client = await createRequestClient();
  t.after(() => client.close());
  const headers = { 'user-agent': 'explicit-client', 'content-type': 'application/json' };
  const defaults = JSON.parse((await client.post(url, '{}', headers)).body);
  assert.equal(defaults['upgrade-insecure-requests'], '1');
  assert.equal(defaults['sec-fetch-user'], '?1');

  for (const options of [
    { disableDefaultHeaders: true },
    { headerOrder: ['host', 'user-agent', 'content-type', 'content-length'], disableDefaultHeaders: false },
    { cookies: 'none' as const, disableDefaultHeaders: true },
  ]) {
    const actual = JSON.parse((await client.post(url, '{}', headers, options)).body);
    assert.equal(actual['user-agent'], 'explicit-client');
    assert.equal(actual['content-type'], 'application/json');
    assert.equal(actual['upgrade-insecure-requests'], undefined);
    assert.equal(actual['sec-fetch-user'], undefined);
  }
});

test('ANA uses one Profile identity and explicit navigation versus sensor headers', async (t) => {
  const { url, received } = await receiver(t);
  const { profile } = await new FpEnvProfiles(path.resolve('test/fixtures/fp-env'))
    .load('android-webview/unknown-v138-1');
  const originalFetch = Session.prototype.fetch;
  // Redirect only the destination; exercise the real session and native header handling.
  t.mock.method(Session.prototype, 'fetch', function (
    this: Session,
    _input: Parameters<Session['fetch']>[0],
    init: Parameters<Session['fetch']>[1],
  ) {
    return originalFetch.call(this, url, init);
  });
  const request = await createAnaRequest({
    profile,
    environment: {
      regional: { languages: ['fr-BJ'], locale: 'fr-BJ', timeZone: 'Africa/Porto-Novo' },
    },
  });
  t.after(() => request.close());
  await request.getLanding();
  await request.getScript('https://aswbe.ana.co.jp/sensor');
  await request.postAbck('https://aswbe.ana.co.jp/sensor', '{}');
  await request.postBms('https://aswbe.ana.co.jp/bms', '{}');
  await request.postFlightSearch();
  assert.equal(received.length, 5);
  for (const headers of received) {
    assert.equal(headers['user-agent'], profile.navigator.userAgent);
    assert.equal(headers['sec-ch-ua'], '"Not)A;Brand";v="8", "Chromium";v="138", "Android WebView";v="138"');
    assert.equal(headers['sec-ch-ua-mobile'], '?1');
    assert.equal(headers['sec-ch-ua-platform'], '"Android"');
    assert.equal(headers['accept-language'], 'fr-BJ,fr;q=0.9');
    assert.equal(headers['accept-encoding'], 'gzip, deflate, br, zstd');
  }
  for (const index of [0, 4]) {
    assert.equal(received[index]!['sec-fetch-user'], '?1');
    assert.equal(received[index]!['upgrade-insecure-requests'], '1');
  }
  for (const index of [1, 2, 3]) {
    assert.equal(received[index]!['sec-fetch-user'], undefined);
    assert.equal(received[index]!['upgrade-insecure-requests'], undefined);
  }
  for (const index of [2, 3]) {
    assert.equal(received[index]!.origin, 'https://aswbe.ana.co.jp');
    assert.equal(received[index]!.referer, 'https://aswbe.ana.co.jp/webapps/reservation/common/system-error');
    assert.equal(received[index]!['sec-fetch-site'], 'same-origin');
    assert.equal(received[index]!['sec-fetch-mode'], 'cors');
    assert.equal(received[index]!['sec-fetch-dest'], 'empty');
  }
  assert.equal(received[2]!.accept, '*/*');
});
