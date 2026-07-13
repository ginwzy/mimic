import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  Catalog, compile, JsdomEngine, LegacyProfiles, parseJob, parseProfile, seal,
  parseShape,
} from '../../src/v2/index.js';
import { screenDriver, screenFeature, screenShape } from '../../src/v2/features/screen.js';
import { viewDriver, viewFeature } from '../../src/v2/features/view.js';

const store = new LegacyProfiles(path.resolve('profiles'));

async function open(id: string) {
  const imported = await store.load(id);
  const { hash: _shapeHash, ...shapeBody } = imported.shape;
  const base = parseShape(seal({
    ...shapeBody,
    features: [],
    ops: [],
    support: { structure: imported.shape.support.structure || imported.shape.level },
  }));
  const shape = screenShape(base);
  const { hash: _hash, ...body } = imported.profile;
  const profile = parseProfile(seal({ ...body, shape: { id: shape.id, hash: shape.hash } }));
  const engine = new JsdomEngine();
  const plan = compile({
    profile,
    catalog: Catalog.create('builtin', [shape], [viewFeature, screenFeature]),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: ['view', 'screen'],
  });
  return { imported, engine, runtime: engine.open(plan, { view: viewDriver, screen: screenDriver }) };
}

test('screen replays typed data with exact interface and EventTarget shape', async () => {
  const { imported, engine, runtime } = await open('macos-chrome-v149');
  try {
    const result = runtime.run(`(() => {
      const o = screen.orientation;
      const seen = [];
      o.addEventListener('change', () => seen.push('change'));
      o.dispatchEvent(new Event('change'));
      o.onchange = function changed() {};
      const lock = o.lock('portrait');
      let screenError, orientationError;
      try { new Screen(); } catch (error) { screenError = [error.name, error.message]; }
      try { new ScreenOrientation(); } catch (error) { orientationError = [error.name, error.message]; }
      return JSON.stringify({
        values: [screen.width, screen.height, screen.availWidth, screen.availHeight, screen.availLeft, screen.availTop, screen.colorDepth, screen.pixelDepth],
        tags: [Object.prototype.toString.call(screen), Object.prototype.toString.call(o)],
        instances: [screen instanceof Screen, screen instanceof EventTarget, o instanceof ScreenOrientation, o instanceof EventTarget],
        own: [Reflect.ownKeys(screen), Reflect.ownKeys(o)],
        orientation: [o.type, o.angle, o === screen.orientation],
        event: [seen, o.onchange.name, Object.hasOwn(o, 'onchange')],
        methods: [o.lock.length, o.unlock.length, o.lock.toString(), o.unlock()],
        promises: lock instanceof Promise,
        errors: [screenError, orientationError],
        screenKeys: Reflect.ownKeys(Screen.prototype).map(String),
      });
    })()`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    assert.deepEqual(value.values, [
      imported.profile.screen.width,
      imported.profile.screen.height,
      imported.profile.screen.availWidth,
      imported.profile.screen.availHeight,
      imported.profile.screen.availLeft,
      imported.profile.screen.availTop,
      imported.profile.screen.colorDepth,
      imported.profile.screen.pixelDepth,
    ]);
    assert.deepEqual(value.tags, ['[object Screen]', '[object ScreenOrientation]']);
    assert.deepEqual(value.instances, [true, true, true, true]);
    assert.deepEqual(value.own, [[], []]);
    assert.deepEqual(value.orientation, [
      imported.profile.screen.orientation.type,
      imported.profile.screen.orientation.angle,
      true,
    ]);
    assert.deepEqual(value.event, [['change'], 'changed', false]);
    assert.deepEqual(value.methods, [1, 0, 'function lock() { [native code] }', null]);
    assert.equal(value.promises, true);
    assert.deepEqual(value.errors, [
      ['TypeError', 'Illegal constructor'],
      ['TypeError', 'Illegal constructor'],
    ]);
    assert.deepEqual(value.screenKeys, [
      'availWidth', 'availHeight', 'width', 'height', 'colorDepth', 'pixelDepth',
      'availLeft', 'availTop', 'orientation', 'constructor', 'onchange', 'isExtended', 'Symbol(Symbol.toStringTag)',
    ]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('screen exposes the centralized legacy orientation fallback', async () => {
  const { engine, runtime } = await open('chrome-mac');
  try {
    const result = runtime.run('JSON.stringify([screen.orientation.type, screen.orientation.angle])');
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), ['landscape-primary', 0]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});
