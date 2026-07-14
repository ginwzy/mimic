import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  Catalog, compile, JsdomEngine, LegacyProfiles, parseJob, parseProfile, seal,
  parseShape,
} from '../src/index.js';
import { viewDriver, viewFeature, viewShape } from '../src/features/view.js';

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
  const shape = viewShape(base);
  const { hash: _hash, ...body } = imported.profile;
  const profile = parseProfile(seal({ ...body, shape: { id: shape.id, hash: shape.hash } }));
  const engine = new JsdomEngine();
  const plan = compile({
    profile,
    catalog: Catalog.create('builtin', [shape], [viewFeature]),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: ['view'],
  });
  return { imported, engine, runtime: engine.open(plan, { view: viewDriver }) };
}

test('view replays captured geometry and installs a Realm-correct VisualViewport', async () => {
  const { imported, engine, runtime } = await open('android-webview-v138');
  try {
    const result = runtime.run(`(() => {
      const vv = visualViewport;
      const seen = [];
      vv.addEventListener('resize', () => seen.push('resize'));
      vv.dispatchEvent(new Event('resize'));
      vv.onresize = function handler() {};
      let ctorError;
      try { new VisualViewport(); } catch (error) { ctorError = { name: error.name, message: error.message }; }
      const descriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
      return JSON.stringify({
        geometry: [innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio],
        values: [vv.width, vv.height, vv.scale, vv.offsetLeft, vv.offsetTop, vv.pageLeft, vv.pageTop],
        same: vv === visualViewport,
        tag: Object.prototype.toString.call(vv),
        visual: vv instanceof VisualViewport,
        event: vv instanceof EventTarget,
        own: Reflect.ownKeys(vv),
        seen,
        handler: vv.onresize?.name,
        handlerOwn: Object.hasOwn(vv, 'onresize'),
        ctor: [VisualViewport.name, VisualViewport.length, VisualViewport.toString()],
        ctorError,
        descriptor: [descriptor.enumerable, descriptor.configurable, descriptor.get.toString()],
      });
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      geometry: [
        imported.profile.window?.innerWidth,
        imported.profile.window?.innerHeight,
        imported.profile.window?.outerWidth,
        imported.profile.window?.outerHeight,
        imported.profile.window?.devicePixelRatio,
      ],
      values: [imported.profile.window?.innerWidth, imported.profile.window?.innerHeight, 1, 0, 0, 0, 0],
      same: true,
      tag: '[object VisualViewport]',
      visual: true,
      event: true,
      own: [],
      seen: ['resize'],
      handler: 'handler',
      handlerOwn: false,
      ctor: ['VisualViewport', 0, 'function VisualViewport() { [native code] }'],
      ctorError: { name: 'TypeError', message: 'Illegal constructor' },
      descriptor: [true, true, 'function get visualViewport() { [native code] }'],
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('view preserves Engine geometry when legacy Profile has no window evidence', async () => {
  const { engine, runtime } = await open('chrome-mac');
  try {
    const result = runtime.run('JSON.stringify([innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio, visualViewport.width, visualViewport.height])');
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), [1024, 768, 1024, 768, 1, 0, 0]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});
