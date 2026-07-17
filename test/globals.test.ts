import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { Catalog, compile, JsdomEngine, LegacyProfiles, parseJob, parseProfile, parseShape, seal } from '../src/index.js';
import { chromeDriver, chromeFeature, touchFeature } from '../src/features/chrome.js';
import { globalsDriver, globalsFeature, globalsShape } from '../src/features/globals.js';
import { navDriver, navFeature } from '../src/features/nav.js';
import { pluginsDriver, pluginsFeature } from '../src/features/plugins.js';
import { screenDriver, screenFeature } from '../src/features/screen.js';
import { uaDriver, uaFeature } from '../src/features/ua.js';
import { viewDriver, viewFeature } from '../src/features/view.js';

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

test('getComputedStyle returns system colors without foreign-Realm errors', async () => {
  const { engine, runtime } = await open('macos-chrome-v149');
  try {
    const result = runtime.run(`(() => {
      const el = document.createElement('div');
      el.style.display = 'none';
      document.head.appendChild(el);
      const colors = ['ActiveBorder', 'Canvas', 'CanvasText', 'Window', 'WindowText', 'ButtonFace'];
      const map = {};
      for (const name of colors) {
        el.style.cssText = 'background-color: ' + name + ' !important';
        map[name] = getComputedStyle(el).backgroundColor;
      }
      el.remove();
      return JSON.stringify(map);
    })()`);
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    const map = JSON.parse(String(result.value)) as Record<string, string>;
    for (const [name, value] of Object.entries(map)) {
      assert.match(value, /^rgba?\(/, `${name}=${value}`);
      assert.notEqual(value, 'e');
    }
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('globals installs Chrome function shapes while preserving source behavior', async () => {
  const { engine, plan, runtime } = await open('macos-chrome-v149');
  try {
    assert.ok(plan.binds.some((bind) => bind.sources?.includes('window.atob')));
    const result = runtime.run(`(() => {
      const names = ['alert', 'atob', 'getComputedStyle', 'matchMedia', 'moveBy', 'setTimeout', 'structuredClone'];
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
      const legacyQuery = matchMedia('(min-width: 1px)');
      let legacyCalls = 0;
      let onchangeCalls = 0;
      const legacyListener = () => legacyCalls++;
      legacyQuery.addListener(legacyListener);
      legacyQuery.dispatchEvent(new Event('change'));
      legacyQuery.removeListener(legacyListener);
      legacyQuery.dispatchEvent(new Event('change'));
      legacyQuery.onchange = () => onchangeCalls++;
      legacyQuery.dispatchEvent(new Event('change'));
      legacyQuery.onchange = null;
      legacyQuery.dispatchEvent(new Event('change'));
      return JSON.stringify({
        shape,
        decoded: atob('bWltaWM='),
        encoded: btoa('mimic'),
        media: [
          matchMedia('(min-width: 1px)'),
          matchMedia('(max-width: 1px)'),
          matchMedia('(orientation: landscape)'),
          matchMedia('(prefers-color-scheme: light)'),
        ].map(query => [
          query.matches,
          query.media,
          query.onchange,
          query instanceof MediaQueryList,
          query instanceof EventTarget,
          Object.prototype.toString.call(query),
          Reflect.ownKeys(query),
          Object.getPrototypeOf(query) === MediaQueryList.prototype,
          typeof query.addListener,
          typeof query.removeListener,
        ]),
        mediaPrototype: [
          Reflect.ownKeys(MediaQueryList.prototype).map(String),
          Object.getPrototypeOf(MediaQueryList.prototype) === EventTarget.prototype,
          [MediaQueryList.name, MediaQueryList.length, Function.prototype.toString.call(MediaQueryList)],
          ['addListener', 'removeListener'].map(name => [
            MediaQueryList.prototype[name].name,
            MediaQueryList.prototype[name].length,
            Function.prototype.toString.call(MediaQueryList.prototype[name]),
          ]),
        ],
        mediaEvents: [legacyCalls, onchangeCalls, legacyQuery.onchange],
        event: calls,
        eventFns: [addEventListener, dispatchEvent, removeEventListener].map(fn => [
          fn.name, fn.length, Function.prototype.toString.call(fn), Object.hasOwn(fn, 'prototype'),
        ]),
      });
    })()`);
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    const value = JSON.parse(String(result.value));
    assert.deepEqual(value.shape.map((item: unknown[]) => item.slice(0, 2)), [
      ['alert', 0], ['atob', 1], ['getComputedStyle', 1], ['matchMedia', 1], ['moveBy', 2], ['setTimeout', 1], ['structuredClone', 1],
    ]);
    for (const item of value.shape) {
      assert.match(item[2], /^function \w+\(\) \{ \[native code\] \}$/);
      assert.equal(item[3], false);
      assert.deepEqual(item[4], ['length', 'name']);
      assert.equal(item[5], true);
    }
    assert.equal(value.decoded, 'mimic');
    assert.equal(value.encoded, 'bWltaWM=');
    assert.deepEqual(value.media, [
      [true, '(min-width: 1px)', null, true, true, '[object MediaQueryList]', [], true, 'function', 'function'],
      [false, '(max-width: 1px)', null, true, true, '[object MediaQueryList]', [], true, 'function', 'function'],
      [true, '(orientation: landscape)', null, true, true, '[object MediaQueryList]', [], true, 'function', 'function'],
      [true, '(prefers-color-scheme: light)', null, true, true, '[object MediaQueryList]', [], true, 'function', 'function'],
    ]);
    assert.deepEqual(value.mediaPrototype, [
      ['media', 'matches', 'onchange', 'addListener', 'removeListener', 'constructor', 'Symbol(Symbol.toStringTag)'],
      true,
      ['MediaQueryList', 0, 'function MediaQueryList() { [native code] }'],
      [
        ['addListener', 1, 'function addListener() { [native code] }'],
        ['removeListener', 1, 'function removeListener() { [native code] }'],
      ],
    ]);
    assert.deepEqual(value.mediaEvents, [1, 1, null]);
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

// Bare `navigator.maxTouchPoints` in port.evaluate was 0/undefined while the page
// navigator had 5 → pointer:fine desktop tell; dual-id BMS tables may gate on coarse.
test('globals matchMedia reports coarse/none for Android maxTouchPoints>0', async () => {
  const { engine, runtime } = await open('android-chrome/2201116sg-v138-10025');
  try {
    const result = runtime.run(`JSON.stringify({
      tp: navigator.maxTouchPoints,
      fine: matchMedia('(pointer: fine)').matches,
      coarse: matchMedia('(pointer: coarse)').matches,
      hoverHover: matchMedia('(hover: hover)').matches,
      hoverNone: matchMedia('(hover: none)').matches,
      anyFine: matchMedia('(any-pointer: fine)').matches,
      anyCoarse: matchMedia('(any-pointer: coarse)').matches,
    })`);
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    const value = JSON.parse(String(result.value));
    assert.ok(value.tp > 0, `maxTouchPoints=${value.tp}`);
    assert.equal(value.fine, false);
    assert.equal(value.coarse, true);
    assert.equal(value.hoverHover, false);
    assert.equal(value.hoverNone, true);
    assert.equal(value.anyFine, false);
    assert.equal(value.anyCoarse, true);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});
