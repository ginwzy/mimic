import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  Catalog, compile, JsdomEngine, LegacyProfiles, parseJob, parseProfile, seal,
} from '../src/index.js';
import { drivers, features } from '../src/features/index.js';

const store = new LegacyProfiles(path.resolve('profiles'), path.resolve('resources/shapes'));

async function open(id: string) {
  const imported = await store.load(id);
  // Artifact shape carries Worker/OffscreenCanvas slots; full feature set matches production.
  const shape = imported.shape;
  const { hash: _hash, ...body } = imported.profile;
  const profile = parseProfile(seal({ ...body, shape: { id: shape.id, hash: shape.hash } }));
  const engine = new JsdomEngine();
  const plan = compile({
    profile,
    catalog: Catalog.create('builtin', [shape], features),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'run', code: '1' }),
    engine: engine.manifest,
    drivers: Object.keys(drivers),
  });
  return { engine, runtime: engine.open(plan, drivers) };
}

test('Worker executes blob: scripts and bridges postMessage both ways', async () => {
  const { engine, runtime } = await open('android-chrome/2201116sg-v138-10025');
  try {
    const result = runtime.run(`(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker timeout')), 3000);
      const source = \`
        self.onmessage = function (ev) {
          var glOk = false, vendor = null;
          try {
            if (typeof OffscreenCanvas === 'function') {
              var gl = new OffscreenCanvas(1, 1).getContext('webgl');
              if (gl) {
                var ext = gl.getExtension('WEBGL_debug_renderer_info');
                glOk = true;
                vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null;
              }
            }
          } catch (e) {}
          postMessage({ echo: ev.data, glOk: glOk, vendor: vendor, nav: typeof navigator });
        };
      \`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url);
      worker.onmessage = function (ev) {
        clearTimeout(timer);
        resolve(ev.data);
      };
      worker.onerror = function (err) {
        clearTimeout(timer);
        reject(new Error(String(err)));
      };
      setTimeout(function () { worker.postMessage({ hello: 1 }); }, 30);
    }))()`);
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    const value = await result.value as {
      echo: { hello: number };
      glOk: boolean;
      vendor: string | null;
      nav: string;
    };
    assert.deepEqual(value.echo, { hello: 1 });
    assert.equal(value.nav, 'object');
    assert.equal(value.glOk, true);
    assert.equal(typeof value.vendor, 'string');
    assert.ok(String(value.vendor).length > 0);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('Worker runs data: URL scripts', async () => {
  const { engine, runtime } = await open('android-chrome/2201116sg-v138-10025');
  try {
    const result = runtime.run(`(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('data worker timeout')), 2000);
      const body = encodeURIComponent('postMessage(40 + 2);');
      const worker = new Worker('data:text/javascript,' + body);
      worker.onmessage = function (ev) {
        clearTimeout(timer);
        resolve(ev.data);
      };
      worker.onerror = function (err) {
        clearTimeout(timer);
        reject(new Error(String(err)));
      };
    }))()`);
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    assert.equal(await result.value, 42);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

// Bare `onconnect=fn` (not self.onconnect=) as in live Cebu BMS SharedWorker blob.
test('SharedWorker accepts bare onconnect assignment under with(self)', async () => {
  const { engine, runtime } = await open('android-chrome/2201116sg-v138-10025');
  try {
    const result = runtime.run(`(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('bare onconnect timeout')), 3000);
      const source = 'onconnect=function(ev){ev.ports[0].postMessage(7)};';
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const sw = new SharedWorker(url);
      sw.port.start();
      sw.port.onmessage = function (ev) {
        clearTimeout(timer);
        resolve(ev.data);
      };
    }))()`);
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    assert.equal(await result.value, 7);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

// Cebu BMS dual-id second table: SharedWorker + port; fails closed with status 260
// when typeof SharedWorker is missing or constructor.name !== "SharedWorker".
test('SharedWorker fires connect and bridges port.postMessage', async () => {
  const { engine, runtime } = await open('android-chrome/2201116sg-v138-10025');
  try {
    const result = runtime.run(`(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('shared worker timeout')), 3000);
      if (typeof SharedWorker !== 'function') {
        clearTimeout(timer);
        reject(new Error('SharedWorker missing'));
        return;
      }
      if (SharedWorker.prototype.constructor.name !== 'SharedWorker') {
        clearTimeout(timer);
        reject(new Error('SharedWorker.name gate failed: ' + SharedWorker.prototype.constructor.name));
        return;
      }
      const source = \`
        self.onconnect = function (ev) {
          var port = ev.ports[0];
          var glOk = false;
          try {
            if (typeof OffscreenCanvas === 'function') {
              var gl = new OffscreenCanvas(0, 0).getContext('webgl');
              glOk = !!gl;
            }
          } catch (e) {}
          port.postMessage({
            ok: true,
            glOk: glOk,
            nav: typeof navigator,
            uad: typeof navigator.userAgentData,
          });
        };
      \`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const sw = new SharedWorker(url);
      sw.port.start();
      sw.port.onmessage = function (ev) {
        clearTimeout(timer);
        resolve(ev.data);
      };
      sw.onerror = function (err) {
        clearTimeout(timer);
        reject(new Error(String(err)));
      };
    }))()`);
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    const value = await result.value as {
      ok: boolean;
      glOk: boolean;
      nav: string;
      uad: string;
    };
    assert.equal(value.ok, true);
    assert.equal(value.nav, 'object');
    assert.equal(value.glOk, true);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});
