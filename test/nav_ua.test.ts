import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { Catalog, compile, JsdomEngine, LegacyProfiles, parseJob, parseProfile, parseShape, seal } from '../src/index.js';
import { chromeDriver, chromeFeature, touchFeature } from '../src/features/chrome.js';
import { navDriver, navFeature, navShape } from '../src/features/nav.js';
import { screenDriver, screenFeature } from '../src/features/screen.js';
import { uaDriver, uaFeature, uaShape } from '../src/features/ua.js';
import { viewDriver, viewFeature } from '../src/features/view.js';

const store = new LegacyProfiles(path.resolve('profiles'));
const features = [viewFeature, screenFeature, chromeFeature, touchFeature, navFeature, uaFeature];
const drivers = { view: viewDriver, screen: screenDriver, chrome: chromeDriver, nav: navDriver, ua: uaDriver };

async function open(id: string) {
  const imported = await store.load(id);
  const { hash: _shapeHash, ...shapeBody } = imported.shape;
  const base = parseShape(seal({
    ...shapeBody, features: [], ops: [],
    support: { structure: imported.shape.support.structure || imported.shape.level },
  }));
  const shape = uaShape(navShape(base));
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
  return { imported, engine, plan, runtime: engine.open(plan, drivers) };
}

test('nav replays normalized scalar and connection data through prototype accessors', async () => {
  const { imported, engine, runtime } = await open('macos-chrome-v149');
  try {
    const result = runtime.run(`(() => {
      const c = navigator.connection;
      const seen = [];
      c.addEventListener('change', () => seen.push('change'));
      c.dispatchEvent(new Event('change'));
      c.onchange = function changed() {};
      const scalar = ['userAgent','appVersion','platform','vendor','language','languages','hardwareConcurrency','deviceMemory','maxTouchPoints','cookieEnabled'];
      return JSON.stringify({
        values: scalar.map(k => navigator[k]),
        own: scalar.map(k => Object.hasOwn(navigator, k)),
        getters: scalar.map(k => Object.getOwnPropertyDescriptor(Navigator.prototype, k).get.toString()),
        fixed: [navigator.webdriver, navigator.pdfViewerEnabled, navigator.doNotTrack, navigator.onLine],
        connection: [c.effectiveType, c.downlink, c.rtt, c.saveData],
        connectionShape: [Object.prototype.toString.call(c), c instanceof NetworkInformation, c instanceof EventTarget, Reflect.ownKeys(c)],
        event: [seen, c.onchange.name, Object.hasOwn(c, 'onchange')],
        navigatorShape: [Reflect.ownKeys(navigator).map(String), Object.prototype.toString.call(navigator), navigator.javaEnabled()],
      });
    })()`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    const nav = imported.profile.navigator;
    assert.deepEqual(value.values, [
      nav.userAgent, nav.appVersion, nav.platform, nav.vendor, nav.language, nav.languages,
      nav.hardwareConcurrency, nav.deviceMemory, nav.maxTouchPoints, nav.cookieEnabled,
    ]);
    assert.deepEqual(value.own, Array(10).fill(false));
    assert.ok(value.getters.every((source: string) => source.includes('[native code]')));
    assert.deepEqual(value.fixed, [false, true, null, true]);
    assert.deepEqual(value.connection, [
      imported.page?.connection?.effectiveType,
      imported.page?.connection?.downlink,
      imported.page?.connection?.rtt,
      imported.page?.connection?.saveData,
    ]);
    assert.deepEqual(value.connectionShape, ['[object NetworkInformation]', true, true, []]);
    assert.deepEqual(value.event, [['change'], 'changed', false]);
    assert.deepEqual(value.navigatorShape, [[], '[object Navigator]', false]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('nav leaves unknown connection capability absent for a real corpus profile', async () => {
  const { imported, engine, plan, runtime } = await open('android-chrome/gpu-adreno-tm-610-v139-57987');
  assert.equal(imported.page, undefined);
  try {
    assert.equal(plan.support['connection.data'], 'unsupported');
    const result = runtime.run(`JSON.stringify({
      navigator: 'connection' in navigator,
      prototype: Object.hasOwn(Navigator.prototype, 'connection'),
      constructor: 'NetworkInformation' in window,
    })`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      navigator: false,
      prototype: false,
      constructor: false,
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('runtime.run with scriptUrl exposes document.currentScript.src (BMS urlKey)', async () => {
  const { engine, runtime } = await open('android-webview-v138');
  const scriptUrl = 'https://www.example.com/FQd/bms.js?v=7fdda865-0972-9d1f-a329-4170ad4217cb';
  try {
    const withUrl = runtime.run(`({
      current: document.currentScript && document.currentScript.src,
      scripts: [...document.scripts].map((s) => s.src),
    })`, { url: scriptUrl });
    assert.equal(withUrl.ok, true, withUrl.ok ? undefined : withUrl.error);
    assert.equal((withUrl.value as { current: string }).current, scriptUrl);
    assert.ok((withUrl.value as { scripts: string[] }).scripts.includes(scriptUrl));

    const without = runtime.run(`document.currentScript`);
    assert.equal(without.ok, true);
    assert.equal(without.value, null);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('nav exposes MediaDevices.enumerateDevices for BMS device probes', async () => {
  const { engine, runtime } = await open('android-webview-v138');
  try {
    const result = runtime.run(`(() => {
      const md = navigator.mediaDevices;
      const pending = md.enumerateDevices();
      return pending.then((devices) => JSON.stringify({
        same: md === navigator.mediaDevices,
        tag: Object.prototype.toString.call(md),
        instance: md instanceof MediaDevices,
        prototypeKeys: Reflect.ownKeys(MediaDevices.prototype).map(String),
        promise: pending instanceof Promise,
        devices,
        enumerate: [
          md.enumerateDevices.name,
          md.enumerateDevices.length,
          Function.prototype.toString.call(md.enumerateDevices),
        ],
      }));
    })()`);
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    const value = JSON.parse(String(await result.value));
    assert.equal(value.same, true);
    assert.equal(value.tag, '[object MediaDevices]');
    assert.equal(value.instance, true);
    assert.equal(value.promise, true);
    assert.ok(Array.isArray(value.devices));
    assert.equal(value.devices.length, 3);
    assert.deepEqual(
      value.devices.map((d: { kind: string }) => d.kind),
      ['audioinput', 'videoinput', 'audiooutput'],
    );
    assert.deepEqual(value.enumerate, [
      'enumerateDevices', 0, 'function enumerateDevices() { [native code] }',
    ]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('nav exposes a Realm-correct StorageManager with promise APIs', async () => {
  const { engine, runtime } = await open('android-webview-v138');
  try {
    const result = runtime.run(`(() => {
      const storage = navigator.storage;
      const estimate = storage.estimate();
      const persisted = storage.persisted();
      const persist = storage.persist();
      const directory = storage.getDirectory();
      return Promise.all([estimate, persisted, persist, directory]).then(([value, isPersisted, didPersist, root]) => JSON.stringify({
        same: storage === navigator.storage,
        shape: [
          Object.prototype.toString.call(storage),
          storage instanceof StorageManager,
          Reflect.ownKeys(storage),
          Object.getPrototypeOf(storage) === StorageManager.prototype,
        ],
        prototypeKeys: Reflect.ownKeys(StorageManager.prototype).map(String),
        promise: [estimate instanceof Promise, persisted instanceof Promise, persist instanceof Promise, directory instanceof Promise],
        value,
        persisted: isPersisted,
        persist: didPersist,
        directory: root,
        methods: ['estimate', 'getDirectory', 'persist', 'persisted'].map(name => [
          storage[name].name,
          storage[name].length,
          storage[name].toString(),
        ]),
      }));
    })()`);
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    const value = JSON.parse(String(await result.value));
    assert.equal(value.same, true);
    assert.deepEqual(value.shape, ['[object StorageManager]', true, [], true]);
    assert.deepEqual(value.prototypeKeys, [
      'persisted', 'persist', 'estimate', 'getDirectory', 'constructor', 'Symbol(Symbol.toStringTag)',
    ]);
    assert.deepEqual(value.promise, [true, true, true, true]);
    assert.deepEqual(value.value, { quota: 10_737_418_240, usage: 0 });
    assert.equal(value.persisted, false);
    assert.equal(value.persist, false);
    assert.equal(value.directory, null);
    assert.deepEqual(value.methods, [
      ['estimate', 0, 'function estimate() { [native code] }'],
      ['getDirectory', 0, 'function getDirectory() { [native code] }'],
      ['persist', 0, 'function persist() { [native code] }'],
      ['persisted', 0, 'function persisted() { [native code] }'],
    ]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('ua preserves captured edge cases and returns target-Realm Promise/data', async () => {
  const { imported, engine, runtime } = await open('android-webview-v138');
  try {
    const result = runtime.run(`(() => {
      const ua = navigator.userAgentData;
      const high = ua.getHighEntropyValues(['architecture','fullVersionList','model','unknown']);
      return high.then(value => JSON.stringify({
        low: [ua.brands, ua.mobile, ua.platform],
        same: ua === navigator.userAgentData,
        tag: Object.prototype.toString.call(ua),
        instance: ua instanceof NavigatorUAData,
        own: Reflect.ownKeys(ua),
        promise: high instanceof Promise,
        high: value,
        realm: value instanceof Object && value.brands instanceof Array,
        json: ua.toJSON(),
        methods: [ua.getHighEntropyValues.length, ua.toJSON.length, ua.getHighEntropyValues.toString(), ua.toJSON.toString()],
      }));
    })()`);
    assert.equal(result.ok, true);
    const json = await result.value;
    const value = JSON.parse(String(json));
    const ua = imported.profile.navigator.userAgentData;
    assert.deepEqual(value.low, [ua.brands, ua.mobile, ua.platform]);
    assert.equal(value.same, true);
    assert.equal(value.tag, '[object NavigatorUAData]');
    assert.equal(value.instance, true);
    assert.deepEqual(value.own, []);
    assert.equal(value.promise, true);
    assert.deepEqual(value.high, {
      brands: ua.brands, mobile: ua.mobile, platform: ua.platform,
      architecture: ua.architecture, fullVersionList: ua.fullVersionList, model: ua.model,
    });
    assert.equal(value.realm, true);
    assert.deepEqual(value.json, { brands: ua.brands, mobile: ua.mobile, platform: ua.platform });
    assert.deepEqual(value.methods, [1, 0, 'function getHighEntropyValues() { [native code] }', 'function toJSON() { [native code] }']);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('ua exposes centralized derived data for legacy profiles without capture', async () => {
  const { imported, engine, runtime } = await open('chrome-mac');
  try {
    assert.equal(imported.profile.evidence.navigator.fields['userAgentData.brands'], 'derived');
    const result = runtime.run('JSON.stringify(navigator.userAgentData.toJSON())');
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      brands: imported.profile.navigator.userAgentData.brands,
      mobile: false,
      platform: 'macOS',
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});
