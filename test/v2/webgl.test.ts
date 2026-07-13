import assert from 'node:assert/strict';
import path from 'node:path';
import test, { after, before } from 'node:test';
import {
  Catalog, compile, JsdomEngine, LegacyProfiles, parseJob, parseProfile, parseShape, seal,
  type Feature,
} from '../../src/v2/index.js';
import { canvasDriver, canvasFeature } from '../../src/v2/features/canvas.js';
import { webglDriver, webglFeature, webglShape } from '../../src/v2/features/webgl.js';

const store = new LegacyProfiles(path.resolve('profiles'));
// Keep the Runtime seam real while excluding unrelated upstream feature graphs from this slice.
const deps = ['view', 'screen', 'chrome', 'touch', 'nav', 'ua', 'plugins', 'globals', 'dom'];
const stubs: Feature[] = deps.map((id) => ({ id, build: () => ({}) }));
const features = [...stubs, canvasFeature, webglFeature];
const drivers = {
  canvas: canvasDriver,
  webgl: webglDriver,
};
const bases = new Map<string, Promise<{
  imported: Awaited<ReturnType<LegacyProfiles['load']>>;
  shape: ReturnType<typeof webglShape>;
  catalog: Catalog;
}>>();

type Opened = Awaited<ReturnType<typeof open>>;
let full: Opened;

before(async () => {
  full = await open('android-chrome/22126rn91y-v139-59164');
});

after(() => {
  if (!full) return;
  full.runtime.dispose();
  assert.equal(full.engine.active, 0);
});

async function base(id: string) {
  const cached = bases.get(id);
  if (cached) return cached;
  const pending = (async () => {
    const imported = await store.load(id);
    const shape = webglShape(parseShape(seal({
      schema: 2,
      id: imported.shape.id,
      target: imported.shape.target,
      level: imported.shape.level,
      source: imported.shape.source,
      features: deps,
      ops: [],
      support: { structure: imported.shape.support.structure ?? 'derived' },
    })));
    return { imported, shape, catalog: Catalog.create('builtin', [shape], features) };
  })();
  bases.set(id, pending);
  return pending;
}

async function open(id: string, removeData = false) {
  const { imported, shape, catalog } = await base(id);
  const { hash: _hash, webgl: _webgl, ...withoutWebgl } = imported.profile;
  const profile = parseProfile(seal({
    ...(removeData ? withoutWebgl : { ...withoutWebgl, webgl: imported.profile.webgl }),
    shape: { id: shape.id, hash: shape.hash },
  }));
  const engine = new JsdomEngine();
  const plan = compile({
    profile,
    catalog,
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: Object.keys(drivers),
  });
  return { engine, plan, runtime: engine.open(plan, drivers), profile };
}

test('webgl creates independent Realm WebGL1 and WebGL2 contexts per canvas and type', async () => {
  const result = full.runtime.run(`(() => {
      const first = document.createElement('canvas');
      const second = document.createElement('canvas');
      const third = document.createElement('canvas');
      const gl1 = first.getContext('webgl');
      const gl2 = second.getContext('webgl2');
      return JSON.stringify({
        present: [!!gl1, !!gl2],
        instances: [gl1 instanceof WebGLRenderingContext, gl2 instanceof WebGL2RenderingContext],
        independent: !(gl2 instanceof WebGLRenderingContext),
        independentMembers: [
          WebGLRenderingContext.prototype.getParameter !== WebGL2RenderingContext.prototype.getParameter,
          Object.getOwnPropertyDescriptor(WebGLRenderingContext.prototype, 'canvas').get !==
            Object.getOwnPropertyDescriptor(WebGL2RenderingContext.prototype, 'canvas').get,
          Object.hasOwn(WebGLRenderingContext.prototype, 'getParameter'),
          Object.hasOwn(WebGL2RenderingContext.prototype, 'getParameter'),
          Object.getPrototypeOf(WebGL2RenderingContext.prototype) === Object.prototype,
        ],
        tags: [Object.prototype.toString.call(gl1), Object.prototype.toString.call(gl2)],
        identity: [
          gl1 === first.getContext('webgl'),
          gl1 === first.getContext('experimental-webgl'),
          gl2 === second.getContext('webgl2'),
          gl1 !== third.getContext('webgl'),
          gl2 !== third.getContext('webgl2'),
          gl1.canvas === first,
          gl2.canvas === second,
        ],
        exclusive: [first.getContext('webgl2'), second.getContext('webgl')],
      });
    })()`);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(String(result.value)), {
      present: [true, true],
      instances: [true, true],
      independent: true,
      independentMembers: [true, true, true, true, true],
      tags: ['[object WebGLRenderingContext]', '[object WebGL2RenderingContext]'],
      identity: [true, true, true, true, true, true, true],
      exclusive: [null, null],
  });
});

test('webgl replays captured parameters with frozen constants and Realm typed arrays', async () => {
  const result = full.runtime.run(`(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const descriptor = Object.getOwnPropertyDescriptor(WebGL2RenderingContext.prototype, 'VENDOR');
      const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      const line = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE);
      return JSON.stringify({
        values: [
          gl.getParameter(gl.VENDOR), gl.getParameter(gl.RENDERER), gl.getParameter(gl.VERSION),
          gl.getParameter(gl.MAX_TEXTURE_SIZE), Array.from(viewport), Array.from(line),
        ],
        realm: [viewport instanceof Int32Array, line instanceof Float32Array],
        unknown: gl.getParameter(999999),
        descriptor: [descriptor.value, descriptor.enumerable, descriptor.writable, descriptor.configurable],
        both: [WebGLRenderingContext.prototype.VENDOR, WebGL2RenderingContext.prototype.VENDOR],
        native: gl.getParameter.toString(),
      });
    })()`);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(String(result.value)), {
      values: [
        'WebKit', 'WebKit WebGL', 'WebGL 2.0 (OpenGL ES 3.0 Chromium)',
        4096, [16383, 16383], [1, 4095.9375],
      ],
      realm: [true, true],
      unknown: null,
      descriptor: [7936, true, false, false],
      both: [7936, 7936],
      native: 'function getParameter() { [native code] }',
  });
});

test('webgl exposes Realm extension lists, debug renderer data, and context attributes', async () => {
  const result = full.runtime.run(`(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const supported = gl.getSupportedExtensions();
      supported.pop();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const attrs = gl.getContextAttributes();
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(debug), 'UNMASKED_VENDOR_WEBGL');
      return JSON.stringify({
        supported: [gl.getSupportedExtensions().length, supported instanceof Array, gl.getSupportedExtensions().includes('WEBGL_debug_renderer_info')],
        debug: [
          Object.prototype.toString.call(debug), debug.constructor.name,
          Object.getOwnPropertyNames(debug).length, typeof WebGLDebugRendererInfo,
          debug.UNMASKED_VENDOR_WEBGL, debug.UNMASKED_RENDERER_WEBGL,
          gl.getParameter(debug.UNMASKED_VENDOR_WEBGL), gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
        ],
        descriptor: [descriptor.value, descriptor.enumerable, descriptor.writable, descriptor.configurable],
        extensionMiss: gl.getExtension('missing'),
        attrs: [
          attrs.constructor === Object, attrs.alpha, attrs.antialias, attrs.depth, attrs.desynchronized,
          attrs.failIfMajorPerformanceCaveat, attrs.powerPreference, attrs.premultipliedAlpha,
          attrs.preserveDrawingBuffer, attrs.stencil, attrs.xrCompatible,
        ],
        native: [gl.getSupportedExtensions.toString(), gl.getExtension.toString(), gl.getContextAttributes.toString()],
      });
    })()`);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(String(result.value)), {
      supported: [10, true, true],
      debug: [
        '[object WebGLDebugRendererInfo]', 'Object', 0, 'undefined', 37445, 37446,
        'ARM', 'Mali-G52 MC2',
      ],
      descriptor: [37445, true, false, false],
      extensionMiss: null,
      attrs: [true, true, true, true, false, false, 'default', true, false, false, false],
      native: [
        'function getSupportedExtensions() { [native code] }',
        'function getExtension() { [native code] }',
        'function getContextAttributes() { [native code] }',
      ],
  });
});

test('webgl creates branded shader precision instances from captured tables', async () => {
  const result = full.runtime.run(`(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const high = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT);
      const low = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.LOW_INT);
      const descriptor = Object.getOwnPropertyDescriptor(WebGLShaderPrecisionFormat.prototype, 'precision');
      return JSON.stringify({
        high: [high.precision, high.rangeMin, high.rangeMax],
        low: [low.precision, low.rangeMin, low.rangeMax],
        brand: [
          high instanceof WebGLShaderPrecisionFormat,
          Object.prototype.toString.call(high),
          high.constructor === WebGLShaderPrecisionFormat,
          Object.getOwnPropertyNames(high).length,
        ],
        miss: gl.getShaderPrecisionFormat(99999, 99999),
        native: [gl.getShaderPrecisionFormat.toString(), descriptor.get.toString()],
      });
    })()`);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(String(result.value)), {
      high: [23, 127, 127],
      low: [0, 15, 14],
      brand: [true, '[object WebGLShaderPrecisionFormat]', true, 0],
      miss: null,
      native: [
        'function getShaderPrecisionFormat() { [native code] }',
        'function get precision() { [native code] }',
      ],
  });
});

test('webgl preserves native interface shapes, drawing buffer accessors, and WebIDL brand checks', async () => {
  const result = full.runtime.run(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 360;
      const gl = canvas.getContext('webgl2');
      const fail = fn => { try { fn(); return null; } catch (error) { return [error instanceof TypeError, error.message]; } };
      const canvasGet = Object.getOwnPropertyDescriptor(WebGL2RenderingContext.prototype, 'canvas').get;
      const widthGet = Object.getOwnPropertyDescriptor(WebGL2RenderingContext.prototype, 'drawingBufferWidth').get;
      const precisionGet = Object.getOwnPropertyDescriptor(WebGLShaderPrecisionFormat.prototype, 'precision').get;
      return JSON.stringify({
        buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        getters: [canvasGet.toString(), widthGet.toString()],
        constructors: [WebGLRenderingContext, WebGL2RenderingContext, WebGLShaderPrecisionFormat].map(Ctor => [
          Ctor.name, Ctor.length, Ctor.toString(), Object.getOwnPropertyNames(Ctor),
        ]),
        illegal: [
          fail(() => new WebGLRenderingContext()),
          fail(() => new WebGL2RenderingContext()),
          fail(() => new WebGLShaderPrecisionFormat()),
        ],
        borrowed: [
          fail(() => WebGL2RenderingContext.prototype.getParameter.call({}, 7936)),
          fail(() => canvasGet.call({})),
          fail(() => widthGet.call({})),
          fail(() => precisionGet.call({})),
        ],
      });
    })()`);
  assert.equal(result.ok, true);
  const value = JSON.parse(String(result.value));
  assert.deepEqual(value.buffer, [640, 360]);
  assert.deepEqual(value.getters, [
      'function get canvas() { [native code] }',
      'function get drawingBufferWidth() { [native code] }',
  ]);
  assert.deepEqual(value.constructors, [
      ['WebGLRenderingContext', 0, 'function WebGLRenderingContext() { [native code] }', ['length', 'name', 'prototype']],
      ['WebGL2RenderingContext', 0, 'function WebGL2RenderingContext() { [native code] }', ['length', 'name', 'prototype']],
      ['WebGLShaderPrecisionFormat', 0, 'function WebGLShaderPrecisionFormat() { [native code] }', ['length', 'name', 'prototype']],
  ]);
  assert.deepEqual(value.illegal, [
      [true, "Failed to construct 'WebGLRenderingContext': Illegal constructor"],
      [true, "Failed to construct 'WebGL2RenderingContext': Illegal constructor"],
      [true, "Failed to construct 'WebGLShaderPrecisionFormat': Illegal constructor"],
  ]);
  for (const failure of value.borrowed) assert.deepEqual(failure, [true, 'Illegal invocation']);
});

test('webgl keeps one deterministic graph while an absent profile stays unsupported and returns null', async () => {
  const supported = full;
  const missing = await open('android-chrome/22126rn91y-v139-59164', true);
  const bindAbi = (binds: typeof supported.plan.binds) => binds.map(({ slot, driver, feature, sources }) => ({
    slot, driver, feature, ...(sources ? { sources } : {}),
  }));
  try {
    assert.equal(missing.profile.webgl, undefined);
    assert.deepEqual(missing.plan.operations, supported.plan.operations);
    assert.deepEqual(bindAbi(missing.plan.binds), bindAbi(supported.plan.binds));
    assert.equal(missing.plan.support['webgl.api'], 'shape-only');
    assert.equal(missing.plan.support['webgl.data'], 'unsupported');
    assert.equal(missing.plan.support['webgl.runtime'], 'unsupported');
    assert.equal(missing.plan.support['webgl.render'], 'unsupported');
    assert.equal(supported.plan.support['webgl.data'], supported.profile.evidence.webgl.support);
    assert.equal(supported.plan.support['webgl.runtime'], 'emulated');
    assert.equal(supported.plan.support['webgl.render'], 'unsupported');

    const result = missing.runtime.run(`(() => {
      const canvas = document.createElement('canvas');
      const contexts = [
        canvas.getContext('webgl'),
        canvas.getContext('experimental-webgl'),
        canvas.getContext('webgl2'),
      ];
      return JSON.stringify({
        contexts,
        fallback: !!canvas.getContext('2d'),
        globals: [
          typeof WebGLRenderingContext,
          typeof WebGL2RenderingContext,
          typeof WebGLShaderPrecisionFormat,
        ],
      });
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      contexts: [null, null, null],
      fallback: true,
      globals: ['function', 'function', 'function'],
    });
  } finally {
    missing.runtime.dispose();
  }
  assert.equal(missing.engine.active, 0);
});
