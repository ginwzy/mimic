import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { Catalog, compile, JsdomEngine, LegacyProfiles, parseJob, parseProfile, parseShape, seal } from '../../src/v2/index.js';
import { chromeDriver, chromeFeature, touchFeature } from '../../src/v2/features/chrome.js';
import { navDriver, navFeature } from '../../src/v2/features/nav.js';
import { pluginsDriver, pluginsFeature, pluginsShape } from '../../src/v2/features/plugins.js';
import { screenDriver, screenFeature } from '../../src/v2/features/screen.js';
import { uaDriver, uaFeature } from '../../src/v2/features/ua.js';
import { viewDriver, viewFeature } from '../../src/v2/features/view.js';

const store = new LegacyProfiles(path.resolve('profiles'));
const features = [viewFeature, screenFeature, chromeFeature, touchFeature, navFeature, uaFeature, pluginsFeature];
const drivers = {
  view: viewDriver, screen: screenDriver, chrome: chromeDriver, nav: navDriver, ua: uaDriver, plugins: pluginsDriver,
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
  const shape = pluginsShape(base);
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
  return { engine, runtime: engine.open(plan, drivers) };
}

test('plugins builds Chrome PDF collections with identity and descriptor invariants', async () => {
  const { engine, runtime } = await open('macos-chrome-v149');
  try {
    const result = runtime.run(`(() => {
      const p = navigator.plugins;
      const m = navigator.mimeTypes;
      const first = p[0];
      return JSON.stringify({
        lengths: [p.length, m.length, first.length],
        names: Array.from(p, x => x.name),
        mime: Array.from(m, x => [x.type, x.suffixes, x.description]),
        instances: [p instanceof PluginArray, m instanceof MimeTypeArray, first instanceof Plugin, m[0] instanceof MimeType],
        tags: [p, m, first, m[0]].map(x => Object.prototype.toString.call(x)),
        item: [p.item(0) === p[0], p.item(99), p.namedItem(first.name) === first, p.namedItem('missing')],
        pluginItem: [first.item(0) === m[0], first.namedItem(m[1].type) === m[1]],
        aliases: [p[first.name] === first, m[m[0].type] === m[0]],
        cycle: [m[0].enabledPlugin === first, first[0] === m[0]],
        keys: [Reflect.ownKeys(p), Reflect.ownKeys(m), Reflect.ownKeys(first)],
        descriptor: [Object.getOwnPropertyDescriptor(p, '0').enumerable, Object.getOwnPropertyDescriptor(p, first.name).enumerable],
        methods: [p.item.length, p.namedItem.length, p.refresh.length, p.item.toString(), p.refresh()],
        ownScalars: ['name','filename','description','length'].map(k => Object.hasOwn(first, k)),
      });
    })()`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    assert.deepEqual(value.lengths, [5, 2, 2]);
    assert.deepEqual(value.names, [
      'PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF',
    ]);
    assert.deepEqual(value.mime, [
      ['application/pdf', 'pdf', 'Portable Document Format'],
      ['text/pdf', 'pdf', 'Portable Document Format'],
    ]);
    assert.deepEqual(value.instances, [true, true, true, true]);
    assert.deepEqual(value.tags, ['[object PluginArray]', '[object MimeTypeArray]', '[object Plugin]', '[object MimeType]']);
    assert.deepEqual(value.item, [true, null, true, null]);
    assert.deepEqual(value.pluginItem, [true, true]);
    assert.deepEqual(value.aliases, [true, true]);
    assert.deepEqual(value.cycle, [true, true]);
    assert.deepEqual(value.keys[0].slice(0, 5), ['0', '1', '2', '3', '4']);
    assert.deepEqual(value.keys[1], ['0', '1', 'application/pdf', 'text/pdf']);
    assert.deepEqual(value.keys[2], ['0', '1', 'application/pdf', 'text/pdf']);
    assert.deepEqual(value.descriptor, [true, false]);
    assert.deepEqual(value.methods, [1, 1, 0, 'function item() { [native code] }', null]);
    assert.deepEqual(value.ownScalars, [false, false, false, false]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('plugins exposes Realm-correct empty collections for WebView', async () => {
  const { engine, runtime } = await open('android-webview-v138');
  try {
    const result = runtime.run(`JSON.stringify({
      lengths: [navigator.plugins.length, navigator.mimeTypes.length],
      keys: [Reflect.ownKeys(navigator.plugins), Reflect.ownKeys(navigator.mimeTypes)],
      instances: [navigator.plugins instanceof PluginArray, navigator.mimeTypes instanceof MimeTypeArray],
      item: [navigator.plugins.item(0), navigator.mimeTypes.namedItem('application/pdf')]
    })`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      lengths: [0, 0], keys: [[], []], instances: [true, true], item: [null, null],
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});
