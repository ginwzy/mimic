import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  Catalog,
  compile,
  JsdomEngine,
  LegacyProfiles,
  parseJob,
  parseProfile,
  parseShape,
  seal,
} from '../../src/v2/index.js';
import { chromeDriver, chromeFeature, touchFeature } from '../../src/v2/features/chrome.js';
import { domFeature } from '../../src/v2/features/dom.js';
import { globalsDriver, globalsFeature } from '../../src/v2/features/globals.js';
import { navDriver, navFeature } from '../../src/v2/features/nav.js';
import { netDriver, netFeature, netShape } from '../../src/v2/features/net.js';
import { pluginsDriver, pluginsFeature } from '../../src/v2/features/plugins.js';
import { screenDriver, screenFeature } from '../../src/v2/features/screen.js';
import { uaDriver, uaFeature } from '../../src/v2/features/ua.js';
import { viewDriver, viewFeature } from '../../src/v2/features/view.js';

const store = new LegacyProfiles(path.resolve('profiles'));
const features = [
  viewFeature, screenFeature, chromeFeature, touchFeature, navFeature, uaFeature,
  pluginsFeature, globalsFeature, domFeature, netFeature,
];
const drivers = {
  view: viewDriver,
  screen: screenDriver,
  chrome: chromeDriver,
  nav: navDriver,
  ua: uaDriver,
  plugins: pluginsDriver,
  globals: globalsDriver,
  net: netDriver,
};

async function open(kind: 'capture' | 'run') {
  const imported = await store.load('macos-chrome-v149');
  const { hash: _shapeHash, ...shapeBody } = imported.shape;
  const base = parseShape(seal({
    ...shapeBody,
    features: [],
    ops: [],
    support: { structure: imported.shape.support.structure || imported.shape.level },
  }));
  const shape = netShape(base);
  const { hash: _profileHash, ...profileBody } = imported.profile;
  const profile = parseProfile(seal({ ...profileBody, shape: { id: shape.id, hash: shape.hash } }));
  const engine = new JsdomEngine();
  const plan = compile({
    profile,
    ...(imported.page ? { page: imported.page } : {}),
    catalog: Catalog.create('net-test', [shape], features),
    job: parseJob({ kind, code: 'void 0' }),
    engine: engine.manifest,
    drivers: Object.keys(drivers),
  });
  return { engine, plan, runtime: engine.open(plan, drivers) };
}

test('net captures synchronous XHR, beacon and fetch bodies without changing callable shape', async () => {
  const { engine, plan, runtime } = await open('capture');
  try {
    const result = runtime.run(`JSON.stringify((() => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/sync');
      const sent = xhr.send('xhr-body');
      const beacon = navigator.sendBeacon('/beacon', 'beacon-body');
      const fetched = fetch('/fetch', { method: 'POST', body: 'fetch-body' });
      return {
        values: [sent, beacon, fetched instanceof Promise, xhr instanceof XMLHttpRequest],
        shape: [XMLHttpRequest.prototype.send, navigator.sendBeacon, fetch].map(fn => [
          fn.name, fn.length, fn.toString(), Object.hasOwn(fn, 'prototype'), fn instanceof Function,
        ]),
      };
    })())`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      values: [null, true, true, true],
      shape: [
        ['send', 0, 'function send() { [native code] }', false, true],
        ['sendBeacon', 1, 'function sendBeacon() { [native code] }', false, true],
        ['fetch', 1, 'function fetch() { [native code] }', false, true],
      ],
    });
    assert.equal(plan.support['net.capture'], 'emulated');
    assert.deepEqual(runtime.report(), {
      net: {
        body: 'xhr-body',
        posts: [
          { via: 'xhr', tag: '[object String]', len: 8, body: 'xhr-body' },
          { via: 'beacon', tag: '[object String]', len: 11, body: 'beacon-body' },
          { via: 'fetch', tag: '[object String]', len: 10, body: 'fetch-body' },
        ],
      },
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('net capture fetch resolves a minimal Realm Response with native body methods', async () => {
  const { engine, runtime } = await open('capture');
  try {
    const result = runtime.run(`(() => {
      const fetched = fetch('/response', { body: 'response-body' });
      return fetched.then(async response => {
        const text = response.text();
        const json = response.json();
        const buffer = response.arrayBuffer();
        const values = await Promise.all([text, json, buffer]);
        const methods = ['text', 'json', 'arrayBuffer'].map(name => {
          const fn = Response.prototype[name];
          return [name, fn.name, fn.length, fn.toString(), Object.hasOwn(fn, 'prototype')];
        });
        return JSON.stringify({
          promise: [fetched instanceof Promise, text instanceof Promise, json instanceof Promise, buffer instanceof Promise],
          response: [response instanceof Response, Object.getPrototypeOf(response) === Response.prototype,
            response.ok, response.status, response.statusText],
          values: [values[0], values[1] instanceof Object, Object.getPrototypeOf(values[1]) === Object.prototype,
            values[2] instanceof ArrayBuffer, values[2].byteLength],
          ctor: [Response.name, Response.length, Response.toString(), Object.hasOwn(Response, 'prototype')],
          methods,
        });
      });
    })()`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(await Promise.resolve(result.value)));
    assert.deepEqual(value.promise, [true, true, true, true]);
    assert.deepEqual(value.response, [true, true, true, 200, 'OK']);
    assert.deepEqual(value.values, ['', true, true, true, 0]);
    assert.deepEqual(value.ctor, ['Response', 0, 'function Response() { [native code] }', true]);
    assert.deepEqual(value.methods.map((item: unknown[]) => item.slice(0, 3)), [
      ['text', 'text', 0], ['json', 'json', 0], ['arrayBuffer', 'arrayBuffer', 0],
    ]);
    for (const item of value.methods) {
      assert.match(item[3], new RegExp(`^function ${item[0]}\\(\\) \\{ \\[native code\\] \\}$`));
      assert.equal(item[4], false);
    }
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('net captures requests after an event and report snapshots cannot mutate Driver state', async () => {
  const { engine, runtime } = await open('capture');
  try {
    const installed = runtime.run(`(() => {
      const empty = new XMLHttpRequest();
      empty.open('POST', '/empty');
      empty.send();
      addEventListener('net-ready', () => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/event');
        xhr.send('event-xhr');
        navigator.sendBeacon('/event-beacon', 'event-beacon');
        fetch('/event-fetch', { body: 'event-fetch' });
      });
    })()`);
    assert.equal(installed.ok, true);
    assert.deepEqual(runtime.report(), {
      net: {
        body: null,
        posts: [{ via: 'xhr', tag: '[object Undefined]', len: 0, body: null }],
      },
    });

    const fired = runtime.run(`dispatchEvent(new Event('net-ready'))`);
    assert.equal(fired.ok, true);
    const report = runtime.report() as {
      net: { body: string | null; posts: Array<{ via: string; tag: string; len: number; body: string | null }> };
    };
    assert.equal(report.net.body, 'event-xhr');
    assert.deepEqual(report.net.posts.slice(1), [
      { via: 'xhr', tag: '[object String]', len: 9, body: 'event-xhr' },
      { via: 'beacon', tag: '[object String]', len: 12, body: 'event-beacon' },
      { via: 'fetch', tag: '[object String]', len: 11, body: 'event-fetch' },
    ]);
    report.net.body = 'changed';
    report.net.posts[1]!.body = 'changed';
    report.net.posts.length = 0;
    const next = runtime.report() as { net: { body: string; posts: Array<{ body: string | null }> } };
    assert.equal(next.net.body, 'event-xhr');
    assert.equal(next.net.posts.length, 4);
    assert.equal(next.net.posts[1]!.body, 'event-xhr');
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('net run mode forwards available sources and never records request bodies', async () => {
  const { engine, plan, runtime } = await open('run');
  try {
    const result = runtime.run(`JSON.stringify((() => {
      let xhrError;
      try { new XMLHttpRequest().send('run-xhr'); } catch (error) { xhrError = error.name; }
      const beacon = navigator.sendBeacon('/run-beacon', 'run-beacon');
      const fetched = fetch('/run-fetch', { body: 'run-fetch' });
      return [xhrError, beacon, fetched instanceof Promise];
    })())`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), ['InvalidStateError', false, true]);
    assert.equal(plan.support['net.capture'], 'unsupported');
    assert.equal(plan.support['net.forward'], 'emulated');
    assert.deepEqual(runtime.report(), { net: { body: null, posts: [] } });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('net rejects borrowed branded methods and closes with a pending fetch safely', async () => {
  const { engine, runtime } = await open('capture');
  const borrowed = runtime.run(`JSON.stringify((() => {
    const errors = [];
    for (const call of [
      () => XMLHttpRequest.prototype.send.call({}, 'borrowed-xhr'),
      () => Navigator.prototype.sendBeacon.call({}, '/borrowed', 'borrowed-beacon'),
      () => Response.prototype.text.call({}),
    ]) {
      try { call(); } catch (error) { errors.push(error.name); }
    }
    return errors;
  })())`);
  assert.equal(borrowed.ok, true);
  assert.deepEqual(JSON.parse(String(borrowed.value)), ['TypeError', 'TypeError', 'TypeError']);
  assert.deepEqual(runtime.report(), { net: { body: null, posts: [] } });

  const pending = runtime.run(`fetch('/pending', { body: 'pending-body' })`);
  assert.equal(pending.ok, true);
  const settled = Promise.resolve(pending.value);
  runtime.dispose();
  await settled;
  assert.throws(() => runtime.report(), /dispose/);
  runtime.dispose();
  assert.equal(engine.active, 0);
});
