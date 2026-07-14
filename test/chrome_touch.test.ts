import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  Catalog, compile, JsdomEngine, LegacyProfiles, parseJob, parseProfile, seal,
  parseShape,
} from '../src/index.js';
import { chromeDriver, chromeFeature, chromeTouchShape, touchFeature } from '../src/features/chrome.js';
import { screenDriver, screenFeature } from '../src/features/screen.js';
import { viewDriver, viewFeature } from '../src/features/view.js';

const store = new LegacyProfiles(path.resolve('profiles'));
const features = [viewFeature, screenFeature, chromeFeature, touchFeature];

async function open(id: string) {
  const imported = await store.load(id);
  const { hash: _shapeHash, ...shapeBody } = imported.shape;
  const base = parseShape(seal({
    ...shapeBody, features: [], ops: [],
    support: { structure: imported.shape.support.structure || imported.shape.level },
  }));
  const shape = chromeTouchShape(base);
  const { hash: _hash, ...body } = imported.profile;
  const profile = parseProfile(seal({ ...body, shape: { id: shape.id, hash: shape.hash } }));
  const engine = new JsdomEngine();
  const plan = compile({
    profile,
    catalog: Catalog.create('builtin', [shape], features),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: ['view', 'screen', 'chrome'],
  });
  return { engine, runtime: engine.open(plan, { view: viewDriver, screen: screenDriver, chrome: chromeDriver }) };
}

test('chrome host exposes only the captured chrome surface', async () => {
  const { engine, runtime } = await open('macos-chrome-v149');
  try {
    const result = runtime.run(`(() => {
      const load = chrome.loadTimes();
      const csi = chrome.csi();
      return JSON.stringify({
        keys: Reflect.ownKeys(chrome),
        proto: Object.getPrototypeOf(chrome) === Object.prototype,
        loadShape: [chrome.loadTimes.name, chrome.loadTimes.length, chrome.loadTimes.toString(), Reflect.ownKeys(chrome.loadTimes)],
        csiShape: [chrome.csi.name, chrome.csi.length, chrome.csi.toString(), Reflect.ownKeys(chrome.csi)],
        load: [load.requestTime, load.commitLoadTime, load.connectionInfo, load.wasNpnNegotiated],
        csi: [csi.startE, csi.onloadT, csi.pageT, csi.tran],
        appKeys: Reflect.ownKeys(chrome.app),
        app: [chrome.app.isInstalled, chrome.app.InstallState.NOT_INSTALLED, chrome.app.RunningState.CANNOT_RUN,
          chrome.app.getDetails(), chrome.app.getIsInstalled(), chrome.app.installState(), chrome.app.runningState()],
        runtime: 'runtime' in chrome,
      });
    })()`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    assert.deepEqual(value.keys, ['loadTimes', 'csi', 'app']);
    assert.equal(value.proto, true);
    assert.deepEqual(value.loadShape, ['', 0, 'function () { [native code] }', ['length', 'name', 'prototype']]);
    assert.deepEqual(value.csiShape, ['', 0, 'function () { [native code] }', ['length', 'name', 'prototype']]);
    assert.ok(Math.abs((value.load[1] - value.load[0]) - 0.04) < 1e-6);
    assert.deepEqual(value.load.slice(2), ['h2', true]);
    assert.equal(value.csi[1] - value.csi[0], 300);
    assert.deepEqual(value.csi.slice(2), [1200.5, 15]);
    assert.deepEqual(value.appKeys, [
      'isInstalled', 'InstallState', 'RunningState', 'getDetails', 'getIsInstalled', 'installState', 'runningState',
    ]);
    assert.deepEqual(value.app, [false, 'not_installed', 'cannot_run', null, false, 'disabled', 'cannot_run']);
    assert.equal(value.runtime, false);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('Shape alone controls Chrome/WebView and mobile/desktop presence', async () => {
  const webview = await open('android-webview-v138');
  try {
    const result = webview.runtime.run(`JSON.stringify({ chrome: 'chrome' in window, orientation: window.orientation,
      doc: ['ontouchstart','ontouchend','ontouchmove','ontouchcancel'].every(k => k in Document.prototype),
      html: ['ontouchstart','ontouchend','ontouchmove','ontouchcancel'].every(k => k in HTMLElement.prototype) })`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), { chrome: false, orientation: 0, doc: true, html: true });
  } finally {
    webview.runtime.dispose();
  }
  assert.equal(webview.engine.active, 0);

  const desktop = await open('macos-chrome-v149');
  try {
    const result = desktop.runtime.run(`JSON.stringify({ orientation: 'orientation' in window,
      doc: ['ontouchstart','ontouchend','ontouchmove','ontouchcancel'].some(k => k in Document.prototype),
      html: ['ontouchstart','ontouchend','ontouchmove','ontouchcancel'].some(k => k in HTMLElement.prototype) })`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), { orientation: false, doc: false, html: false });
  } finally {
    desktop.runtime.dispose();
  }
  assert.equal(desktop.engine.active, 0);
});
