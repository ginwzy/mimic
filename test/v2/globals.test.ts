import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { Catalog, compile, JsdomEngine, LegacyProfiles, parseJob, parseProfile, parseShape, seal } from '../../src/v2/index.js';
import { chromeDriver, chromeFeature, touchFeature } from '../../src/v2/features/chrome.js';
import { globalsDriver, globalsFeature, globalsShape } from '../../src/v2/features/globals.js';
import { navDriver, navFeature } from '../../src/v2/features/nav.js';
import { pluginsDriver, pluginsFeature } from '../../src/v2/features/plugins.js';
import { screenDriver, screenFeature } from '../../src/v2/features/screen.js';
import { uaDriver, uaFeature } from '../../src/v2/features/ua.js';
import { viewDriver, viewFeature } from '../../src/v2/features/view.js';

const store = new LegacyProfiles(path.resolve('profiles'));
const features = [
  viewFeature, screenFeature, chromeFeature, touchFeature, navFeature, uaFeature, pluginsFeature, globalsFeature,
];
const drivers = {
  view: viewDriver,
  screen: screenDriver,
  chrome: chromeDriver,
  nav: navDriver,
  ua: uaDriver,
  plugins: pluginsDriver,
  globals: globalsDriver,
};

async function open(id: string) {
  const imported = await store.load(id);
  const { hash: _shapeHash, ...shapeBody } = imported.shape;
  const base = parseShape(seal({
    ...shapeBody,
    features: [],
    ops: [],
    support: { structure: imported.shape.support.structure || imported.shape.level },
  }));
  const shape = globalsShape(base);
  const { hash: _hash, ...body } = imported.profile;
  const profile = parseProfile(seal({ ...body, shape: { id: shape.id, hash: shape.hash } }));
  const engine = new JsdomEngine();
  const plan = compile({
    profile,
    catalog: Catalog.create('builtin', [shape], features),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: Object.keys(drivers),
  });
  return { engine, plan, runtime: engine.open(plan, drivers) };
}

test('globals installs Chrome function shapes while preserving source behavior', async () => {
  const { engine, plan, runtime } = await open('macos-chrome-v149');
  try {
    assert.ok(plan.binds.some((bind) => bind.sources?.includes('window.atob')));
    const result = runtime.run(`(() => {
      const names = ['alert', 'atob', 'getComputedStyle', 'moveBy', 'setTimeout', 'structuredClone'];
      const shape = names.map(name => {
        const value = window[name];
        return [
          value.name,
          value.length,
          Function.prototype.toString.call(value),
          Object.hasOwn(value, 'prototype'),
          Reflect.ownKeys(value).map(String),
          value instanceof Function,
        ];
      });
      const target = new EventTarget();
      let calls = 0;
      target.addEventListener('ready', () => calls++);
      target.dispatchEvent(new Event('ready'));
      return JSON.stringify({
        shape,
        decoded: atob('bWltaWM='),
        encoded: btoa('mimic'),
        event: calls,
        eventFns: [addEventListener, dispatchEvent, removeEventListener].map(fn => [
          fn.name, fn.length, Function.prototype.toString.call(fn), Object.hasOwn(fn, 'prototype'),
        ]),
      });
    })()`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    assert.deepEqual(value.shape.map((item: unknown[]) => item.slice(0, 2)), [
      ['alert', 0], ['atob', 1], ['getComputedStyle', 1], ['moveBy', 2], ['setTimeout', 1], ['structuredClone', 1],
    ]);
    for (const item of value.shape) {
      assert.match(item[2], /^function \w+\(\) \{ \[native code\] \}$/);
      assert.equal(item[3], false);
      assert.deepEqual(item[4], ['length', 'name']);
      assert.equal(item[5], true);
    }
    assert.equal(value.decoded, 'mimic');
    assert.equal(value.encoded, 'bWltaWM=');
    assert.equal(value.event, 1);
    assert.deepEqual(value.eventFns, [
      ['addEventListener', 2, 'function addEventListener() { [native code] }', false],
      ['dispatchEvent', 1, 'function dispatchEvent() { [native code] }', false],
      ['removeEventListener', 2, 'function removeEventListener() { [native code] }', false],
    ]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('globals keeps APIs absent when the WebView Shape says they are absent', async () => {
  const { engine, runtime } = await open('android-webview-v138');
  try {
    const result = runtime.run(`JSON.stringify({
      queryLocalFonts: typeof queryLocalFonts,
      webkitRequestFileSystem: typeof webkitRequestFileSystem,
      webkitResolveLocalFileSystemURL: typeof webkitResolveLocalFileSystemURL,
      getScreenDetails: [typeof getScreenDetails, getScreenDetails.name, getScreenDetails.length]
    })`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      queryLocalFonts: 'undefined',
      webkitRequestFileSystem: 'undefined',
      webkitResolveLocalFileSystemURL: 'undefined',
      getScreenDetails: ['function', 'getScreenDetails', 0],
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});
