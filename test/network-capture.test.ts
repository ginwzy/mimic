import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import { createMimic } from '../src/sdk.js';
import { digest, seal } from '../src/core/seal.js';
import type { CaptureOptions } from '../src/app/types.js';
import { createAnaRequest } from '../flow/suppliers/ana/request.js';

test('closed-loop worker capture delivers responses and scoped cookies in the same Realm', async () => {
  const requests: { url: string; body: string; cookie: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    requests.push({ url: request.url!, body, cookie: request.headers.cookie ?? '' });
    if (request.url === '/first') {
      response.writeHead(201, {
        'content-type': 'application/json', 'x-step': 'first',
        'set-cookie': ['visible=one; Path=/', 'secret=hidden; Path=/; HttpOnly', 'scoped=yes; Path=/private'],
      });
      response.end('{"step":1}');
    } else if (request.url === '/second') {
      response.setHeader('content-type', 'application/json');
      response.end('{"step":2}');
    } else response.end('done');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const mimic = createMimic({
    profile: 'android-webview/unknown-v138-1', profilesRoot: path.resolve('test/fixtures/fp-env'), size: 1, timeoutMs: 8_000,
    page: seal({ schema: 2, id: 'network-page', source: { kind: 'manual', hash: digest('network-page') }, url: `${origin}/page` }),
    capture: { deadlineMs: 4_000, pollMs: 10, maxPosts: 3 },
    network: {
      allowedUrls: ['/first', '/second', '/done'].map(path => origin + path),
      cookies: [{ url: origin, value: 'expired=old; Path=/; Max-Age=1', receivedAt: Date.now() - 60_000 }],
      request: request => fetch(request),
    },
  });
  try {
    const result = await mimic.capture({ kind: 'capture', code: `
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/first');
      xhr.onload = () => {
        fetch('/second', { method: 'POST', body: JSON.stringify({
          status: xhr.status, body: JSON.parse(xhr.responseText),
          header: xhr.getResponseHeader('x-step'), forbidden: xhr.getResponseHeader('set-cookie'),
          cookie: document.cookie, readyState: xhr.readyState,
        }) }).then(async response => {
          if (response.headers.get('content-type') !== 'application/json') throw new Error('missing response headers');
          if (Object.getOwnPropertyDescriptor(response, 'bodyUsed').get.constructor !== Function) throw new Error('foreign getter');
          const value = await response.json();
          if (!response.bodyUsed) throw new Error('body not consumed');
          const frame = document.createElement('iframe');
          document.body.append(frame);
          frame.contentWindow.navigator.sendBeacon('/done', JSON.stringify({ value, cookie: document.cookie }));
        });
      };
      xhr.send('first');
    ` });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(requests.map(request => request.url), ['/first', '/second', '/done']);
    assert.equal(requests[0]!.cookie, '');
    assert.deepEqual(JSON.parse(requests[1]!.body), {
      status: 201, body: { step: 1 }, header: 'first', forbidden: null, cookie: 'visible=one', readyState: 4,
    });
    assert.match(requests[1]!.cookie, /secret=hidden/);
    assert.doesNotMatch(requests[1]!.cookie, /scoped=/);
    assert.deepEqual(JSON.parse(requests[2]!.body), { value: { step: 2 }, cookie: 'visible=one' });
    assert.equal(result.value!.posts.length, 3);
    assert.equal((result.report!.net as { pending: number }).pending, 0);
  } finally {
    await mimic.close();
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
  assert.equal(mimic.executor.workerLifecycle.live, 0);
});

function captureClient(request: (request: Request) => Promise<Response>, paths: string[], capture: CaptureOptions = {}, timeoutMs = 8_000) {
  return createMimic({
    profile: 'android-webview/unknown-v138-1', profilesRoot: path.resolve('test/fixtures/fp-env'), size: 1, timeoutMs,
    page: seal({ schema: 2, id: 'network-fixture', source: { kind: 'manual', hash: digest('network-fixture') }, url: 'https://fixture.invalid/page' }),
    capture: { deadlineMs: 2_000, pollMs: 10, maxPosts: 2, ...capture },
    network: { allowedUrls: paths.map(path => new URL(path, 'https://fixture.invalid').href), request },
  });
}

test('closed-loop checks every redirect, refuses synchronous XHR, and recovers for the next task', async () => {
  const received: string[] = [];
  const mimic = captureClient(async request => {
    received.push(new URL(request.url).pathname);
    if (request.url.endsWith('/redirect')) return new Response(null, { status: 302, headers: { location: '/blocked' } });
    return new Response('done');
  }, ['/redirect', '/done']);
  try {
    const result = await mimic.capture({ kind: 'capture', code: `
      let syncRejected = false;
      const sync = new XMLHttpRequest();
      sync.open('POST', '/blocked', false);
      try { sync.send('sync'); } catch (error) { syncRejected = error instanceof TypeError; }
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/redirect');
      xhr.onerror = () => navigator.sendBeacon('/done', JSON.stringify({ syncRejected, status: xhr.status }));
      xhr.send();
    ` });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(received, ['/redirect', '/done']);
    assert.deepEqual(JSON.parse(result.value!.posts.at(-1)!.body!), { syncRejected: true, status: 0 });
    received.length = 0;
    const next = await mimic.capture({ kind: 'capture', code: "navigator.sendBeacon('/done', 'next')" });
    assert.ok(next.ok, JSON.stringify(next));
    assert.deepEqual(received, ['/done']);
    assert.equal(mimic.executor.workerLifecycle.created, 1);
  } finally { await mimic.close(); }
});

test('closed-loop forwards HTTP failures and approved redirects as browser responses', async () => {
  const cookies: string[] = [];
  const mimic = captureClient(async request => {
    if (request.url.endsWith('/redirect')) return new Response(null, {
      status: 302, headers: { location: '/failure', 'set-cookie': 'step=redirect; Path=/; HttpOnly' },
    });
    if (request.url.endsWith('/failure')) {
      cookies.push(request.headers.get('cookie') ?? '');
      return new Response('denied', { status: 403, statusText: 'Forbidden' });
    }
    return new Response('done');
  }, ['/redirect', '/failure', '/done']);
  try {
    const result = await mimic.capture({ kind: 'capture', code: `
      fetch('/redirect').then(async response => {
        navigator.sendBeacon('/done', JSON.stringify({ status: response.status, ok: response.ok,
          text: await response.text(), url: response.url, cookie: document.cookie }));
      });
    ` });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(cookies, ['step=redirect']);
    assert.deepEqual(JSON.parse(result.value!.posts.at(-1)!.body!), {
      status: 403, ok: false, text: 'denied', url: 'https://fixture.invalid/failure', cookie: '',
    });
  } finally { await mimic.close(); }
});

for (const stop of ['deadline', 'watchdog', 'close'] as const) {
  test(`closed-loop ${stop} cancels host I/O and releases the worker`, async () => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let aborted!: () => void;
    const cancelled = new Promise<void>(resolve => { aborted = resolve; });
    const mimic = captureClient(request => new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => { aborted(); reject(request.signal.reason); }, { once: true });
      started();
    }), ['/slow'], { deadlineMs: stop === 'deadline' ? 400 : 20_000, maxPosts: 1 }, stop === 'watchdog' ? 1_200 : 8_000);
    try {
      const execution = mimic.capture({ kind: 'capture', code: `
        fetch('/slow', { method: 'POST', body: 'slow' }).catch(() => {});
        ${stop === 'watchdog' ? 'setTimeout(() => { while (true) {} }, 200);' : ''}
      ` }).then(result => ({ result }), error => ({ error }));
      await ready;
      if (stop === 'close') await mimic.close();
      const outcome = await execution;
      if ('error' in outcome) {
        assert.equal(stop, 'close');
        assert.match(String(outcome.error), /destroyed/);
      } else {
        assert.equal(outcome.result.ok, false);
        if (!outcome.result.ok && stop === 'deadline') assert.match(outcome.result.error.message, /pending network requests/);
      }
      await cancelled;
    } finally { await mimic.close(); }
    assert.equal(mimic.executor.workerLifecycle.live, 0);
  });
}

test('ANA native transport preserves raw bootstrap cookies and does not overwrite Realm cookie edits', async () => {
  const received: { body: string; cookie: string }[] = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/bootstrap') {
      response.setHeader('set-cookie', ['secret=hidden; Path=/; HttpOnly', 'visible=old; Path=/']);
      response.end('bootstrap');
      return;
    }
    let body = '';
    for await (const chunk of request) body += String(chunk);
    received.push({ body, cookie: request.headers.cookie ?? '' });
    response.setHeader('set-cookie', 'updated=yes; Path=/; HttpOnly');
    response.end('accepted');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const request = await createAnaRequest({ closedLoop: true });
  let mimic: ReturnType<typeof createMimic> | undefined;
  try {
    await request.getScript(`${origin}/bootstrap`);
    const network = request.captureNetwork(`${origin}/wire`, `${origin}/page`);
    assert.equal(network.cookies!.length, 2);
    mimic = createMimic({
      profile: 'android-webview/unknown-v138-1', profilesRoot: path.resolve('test/fixtures/fp-env'), size: 1, timeoutMs: 8_000,
      page: seal({ schema: 2, id: 'ana-local', source: { kind: 'manual', hash: digest('ana-local') }, url: `${origin}/page` }),
      network, capture: { maxPosts: 1, deadlineMs: 2_000, pollMs: 10 },
    });
    const result = await mimic.capture({ kind: 'capture', code: `
      document.cookie = 'visible=new; Path=/';
      navigator.sendBeacon('/wire', document.cookie);
    ` });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(received, [{ body: 'visible=new', cookie: 'secret=hidden; visible=new' }]);
    assert.match(request.cookies(`${origin}/`), /updated=yes/);
  } finally {
    await mimic?.close();
    await request.close();
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});

test('closed-loop preserves CORS preflight and credential rules', async () => {
  const received: { method: string; path: string; cookie: string }[] = [];
  const mimic = captureClient(async request => {
    const path = new URL(request.url).pathname;
    received.push({ method: request.method, path, cookie: request.headers.get('cookie') ?? '' });
    if (path === '/done') return new Response('done');
    if (path === '/deny') return new Response('no CORS headers');
    const headers = {
      'access-control-allow-origin': 'https://fixture.invalid',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'x-probe',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    return new Response('accepted', { headers: { ...headers, 'set-cookie': 'cors=ok; Path=/; HttpOnly; Secure' } });
  }, ['https://other.invalid/one', 'https://other.invalid/two', 'https://other.invalid/deny', '/done'], { maxPosts: 3 });
  try {
    const result = await mimic.capture({ kind: 'capture', code: `
      const init = { method: 'POST', headers: { 'x-probe': 'test' }, body: 'probe', credentials: 'include' };
      fetch('https://other.invalid/one', init)
        .then(() => fetch('https://other.invalid/two', init))
        .then(() => fetch('https://other.invalid/deny'))
        .catch(error => navigator.sendBeacon('/done', JSON.stringify({ realmError: error instanceof TypeError, cookie: document.cookie })));
    ` });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(received, [
      { method: 'OPTIONS', path: '/one', cookie: '' },
      { method: 'POST', path: '/one', cookie: '' },
      { method: 'OPTIONS', path: '/two', cookie: '' },
      { method: 'POST', path: '/two', cookie: 'cors=ok' },
      { method: 'GET', path: '/deny', cookie: '' },
      { method: 'POST', path: '/done', cookie: '' },
    ]);
    assert.deepEqual(JSON.parse(result.value!.posts.at(-1)!.body!), { realmError: true, cookie: '' });
  } finally { await mimic.close(); }
});

test('closed-loop close cancels an in-progress response stream', async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let cancelled!: () => void;
  const cancellation = new Promise<void>(resolve => { cancelled = resolve; });
  const mimic = captureClient(async () => new Response(new ReadableStream({
    start() { started(); }, cancel() { cancelled(); },
  })), ['/stream'], { maxPosts: 1, deadlineMs: 20_000 });
  try {
    const execution = mimic.capture({ kind: 'capture', code: "fetch('/stream', {method:'POST',body:'stream'}).catch(() => {})" });
    const failure = assert.rejects(execution, /destroyed/);
    await ready;
    await mimic.close();
    await failure;
    await cancellation;
  } finally { await mimic.close(); }
  assert.equal(mimic.executor.workerLifecycle.live, 0);
});

test('closed-loop rejects non-HTTP XHR and keeps element resource loading disabled', async () => {
  const received: string[] = [];
  const mimic = captureClient(async request => {
    received.push(request.url);
    return new Response('done');
  }, ['/done'], { maxPosts: 1 });
  try {
    const result = await mimic.capture({ kind: 'capture', code: `
      const blocked = [];
      for (const url of ['file:///missing-capture-file', 'data:text/plain,unexpected']) {
        const xhr = new XMLHttpRequest(); xhr.open('GET', url);
        try { xhr.send(); } catch (error) { blocked.push(error instanceof TypeError); }
      }
      const frame = document.createElement('iframe');
      frame.src = 'data:text/html,<body>unexpected-resource'; document.body.append(frame);
      setTimeout(() => navigator.sendBeacon('/done', JSON.stringify({ blocked,
        loaded: Boolean(frame.contentDocument.body?.textContent.includes('unexpected-resource')),
      })), 20);
    ` });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(received, ['https://fixture.invalid/done']);
    assert.deepEqual(JSON.parse(result.value!.posts.at(-1)!.body!), { blocked: [true, true], loaded: false });
  } finally { await mimic.close(); }
});

test('closed-loop bounds buffered responses and exposes failure through fetch rejection', async () => {
  const received: string[] = [];
  const mimic = captureClient(async request => {
    const path = new URL(request.url).pathname;
    received.push(path);
    return path === '/large' ? new Response(new Uint8Array(8 * 1024 * 1024 + 1)) : new Response('done');
  }, ['/large', '/done'], { maxPosts: 1 });
  try {
    const result = await mimic.capture({ kind: 'capture', code: `
      fetch('/large').catch(error => navigator.sendBeacon('/done', String(error instanceof TypeError)));
    ` });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(received, ['/large', '/done']);
    assert.equal(result.value!.posts.at(-1)!.body, 'true');
  } finally { await mimic.close(); }
});
