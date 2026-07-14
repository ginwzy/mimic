import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  Catalog, compile, JsdomEngine, LegacyProfiles, parseJob, parseProfile, parseShape, seal,
  type Driver, type Feature,
} from '../src/index.js';
import { canvasContext, canvasDriver, canvasFeature, canvasShape } from '../src/features/canvas.js';
import { chromeDriver, chromeFeature, touchFeature } from '../src/features/chrome.js';
import { domFeature } from '../src/features/dom.js';
import { globalsDriver, globalsFeature } from '../src/features/globals.js';
import { navDriver, navFeature } from '../src/features/nav.js';
import { netDriver, netFeature, netShape } from '../src/features/net.js';
import { pluginsDriver, pluginsFeature } from '../src/features/plugins.js';
import { screenDriver, screenFeature } from '../src/features/screen.js';
import { uaDriver, uaFeature } from '../src/features/ua.js';
import { viewDriver, viewFeature } from '../src/features/view.js';

const store = new LegacyProfiles(path.resolve('profiles'));
const features = [
  viewFeature, screenFeature, chromeFeature, touchFeature, navFeature, uaFeature,
  pluginsFeature, globalsFeature, domFeature, netFeature, canvasFeature,
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
  canvas: canvasDriver,
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
  const shape = canvasShape(netShape(base));
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

test('canvas creates Realm-correct context, image, and metrics instances per element', async () => {
  const { engine, runtime } = await open('macos-chrome-v149');
  try {
    const result = runtime.run(`(() => {
      const first = document.createElement('canvas');
      const second = document.createElement('canvas');
      const context = first.getContext('2d');
      const image = context.getImageData(0, 0, 2, 3);
      const metrics = context.measureText('mimic');
      return JSON.stringify({
        identity: [context === first.getContext('2d'), context !== second.getContext('2d')],
        canvas: context.canvas === first,
        instances: [
          context instanceof CanvasRenderingContext2D,
          image instanceof ImageData,
          metrics instanceof TextMetrics,
        ],
        tags: [context, image, metrics].map(value => Object.prototype.toString.call(value)),
        constructors: [
          context.constructor === CanvasRenderingContext2D,
          image.constructor === ImageData,
          metrics.constructor === TextMetrics,
        ],
        unsupported: first.getContext('webgl'),
      });
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      identity: [true, true],
      canvas: true,
      instances: [true, true, true],
      tags: ['[object CanvasRenderingContext2D]', '[object ImageData]', '[object TextMetrics]'],
      constructors: [true, true, true],
      unsupported: null,
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('canvas exposes native-shaped drawing methods with basic non-pixel returns', async () => {
  const { engine, runtime } = await open('macos-chrome-v149');
  try {
    const result = runtime.run(`(() => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const tell = (owner, key) => {
        const fn = Object.getOwnPropertyDescriptor(owner, key).value;
        return [fn.name, fn.length, fn.toString(), Object.hasOwn(fn, 'prototype')];
      };
      const initial = [context.fillStyle, context.strokeStyle, context.globalAlpha, context.lineWidth, context.font];
      context.fillStyle = '#123456';
      context.strokeStyle = '#abcdef';
      context.globalAlpha = 0.5;
      context.lineWidth = 3;
      context.font = '12px sans-serif';
      const calls = [
        context.clearRect(0, 0, 1, 1),
        context.fillRect(0, 0, 1, 1),
        context.strokeRect(0, 0, 1, 1),
        context.fillText('mimic', 1, 2),
        context.strokeText('mimic', 1, 2),
        context.beginPath(), context.moveTo(0, 0), context.lineTo(1, 1), context.arc(1, 1, 1, 0, 1),
        context.closePath(), context.fill(), context.stroke(), context.save(), context.restore(),
        context.translate(1, 2), context.rotate(1), context.scale(2, 2),
      ];
      const metrics = context.measureText('mimic');
      const image = context.getImageData(0, 0, 2, 3);
      const made = new ImageData(1, 2);
      calls.push(context.putImageData(image, 0, 0));
      const illegal = [];
      for (const Ctor of [CanvasRenderingContext2D, TextMetrics]) {
        try { new Ctor(); illegal.push(false); } catch (error) { illegal.push(error instanceof TypeError); }
      }
      return JSON.stringify({
        shapes: {
          getContext: tell(HTMLCanvasElement.prototype, 'getContext'),
          toDataURL: tell(HTMLCanvasElement.prototype, 'toDataURL'),
          fillRect: tell(CanvasRenderingContext2D.prototype, 'fillRect'),
          fillText: tell(CanvasRenderingContext2D.prototype, 'fillText'),
          measureText: tell(CanvasRenderingContext2D.prototype, 'measureText'),
          getImageData: tell(CanvasRenderingContext2D.prototype, 'getImageData'),
          putImageData: tell(CanvasRenderingContext2D.prototype, 'putImageData'),
        },
        initial,
        styles: [context.fillStyle, context.strokeStyle, context.globalAlpha, context.lineWidth, context.font],
        calls,
        metrics: [metrics.width, typeof metrics.actualBoundingBoxLeft],
        image: [image.width, image.height, image.colorSpace, image.data.length, image.data instanceof Uint8ClampedArray],
        made: [made.width, made.height, made.colorSpace, made.data.length, made instanceof ImageData],
        urls: [canvas.toDataURL(), canvas.toDataURL('image/jpeg')],
        illegal,
      });
    })()`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    assert.deepEqual(value.shapes, {
      getContext: ['getContext', 1, 'function getContext() { [native code] }', false],
      toDataURL: ['toDataURL', 0, 'function toDataURL() { [native code] }', false],
      fillRect: ['fillRect', 4, 'function fillRect() { [native code] }', false],
      fillText: ['fillText', 3, 'function fillText() { [native code] }', false],
      measureText: ['measureText', 1, 'function measureText() { [native code] }', false],
      getImageData: ['getImageData', 4, 'function getImageData() { [native code] }', false],
      putImageData: ['putImageData', 3, 'function putImageData() { [native code] }', false],
    });
    assert.deepEqual(value.initial, ['#000000', '#000000', 1, 1, '10px sans-serif']);
    assert.deepEqual(value.styles, ['#123456', '#abcdef', 0.5, 3, '12px sans-serif']);
    assert.deepEqual(value.calls, Array(18).fill(null));
    assert.deepEqual(value.metrics, [35, 'number']);
    assert.deepEqual(value.image, [2, 3, 'srgb', 24, true]);
    assert.deepEqual(value.made, [1, 2, 'srgb', 8, true]);
    assert.deepEqual(value.urls, ['data:image/png;base64,', 'data:image/jpeg;base64,']);
    assert.deepEqual(value.illegal, [true, true]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('canvas creates gradient and Path2D interface shells without claiming raster output', async () => {
  const { engine, runtime } = await open('macos-chrome-v149');
  try {
    const result = runtime.run(`(() => {
      const context = document.createElement('canvas').getContext('2d');
      const linear = context.createLinearGradient(0, 0, 10, 0);
      const radial = context.createRadialGradient(0, 0, 1, 2, 2, 3);
      const conic = context.createConicGradient(0, 1, 1);
      linear.addColorStop(0, '#fff');
      const path = new Path2D();
      path.moveTo(0, 0); path.lineTo(10, 10); path.arc(5, 5, 3, 0, 7); path.roundRect(0, 0, 5, 5);
      path.closePath();
      context.fill(path); context.stroke(path);
      const tell = (fn) => [fn.name, fn.length, fn.toString(), Object.hasOwn(fn, 'prototype')];
      return JSON.stringify({
        gradients: [linear, radial, conic].map(value => [
          value instanceof CanvasGradient,
          Object.prototype.toString.call(value),
          value.constructor === CanvasGradient,
        ]),
        gradientMethod: tell(CanvasGradient.prototype.addColorStop),
        path: [path instanceof Path2D, Object.prototype.toString.call(path), path.constructor === Path2D],
        pathMethods: [tell(Path2D.prototype.arc), tell(Path2D.prototype.roundRect), tell(Path2D.prototype.addPath)],
        orders: [
          Object.getOwnPropertyNames(CanvasGradient.prototype).at(-1),
          Object.getOwnPropertyNames(Path2D.prototype).at(-1),
        ],
      });
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      gradients: Array(3).fill([true, '[object CanvasGradient]', true]),
      gradientMethod: ['addColorStop', 2, 'function addColorStop() { [native code] }', false],
      path: [true, '[object Path2D]', true],
      pathMethods: [
        ['arc', 5, 'function arc() { [native code] }', false],
        ['roundRect', 4, 'function roundRect() { [native code] }', false],
        ['addPath', 1, 'function addPath() { [native code] }', false],
      ],
      orders: ['constructor', 'constructor'],
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('canvas covers the standard shape-only context method surface and Chrome arities', async () => {
  const { engine, runtime } = await open('macos-chrome-v149');
  try {
    const result = runtime.run(`(() => {
      const context = document.createElement('canvas').getContext('2d');
      context.setTransform(); context.roundRect(0, 0, 1, 1); context.resetTransform(); context.reset();
      const attrs = context.getContextAttributes();
      const matrix = context.getTransform();
      const lengths = Object.fromEntries([
        'setTransform', 'roundRect', 'fillText', 'strokeText', 'createImageData',
        'getImageData', 'arc', 'measureText', 'bezierCurveTo', 'ellipse', 'setLineDash',
      ].map(name => [name, context[name].length]));
      return JSON.stringify({
        lengths,
        attrs: [Object.keys(attrs), attrs.alpha, attrs.colorSpace, attrs.desynchronized, attrs.willReadFrequently],
        matrix: [matrix.a, matrix.d, matrix.e, matrix.f, matrix.is2D, matrix.isIdentity, Object.prototype.toString.call(matrix)],
        values: [context.isContextLost(), context.isPointInPath(0, 0), context.isPointInStroke(0, 0)],
        dash: [context.getLineDash(), context.getLineDash() instanceof Array],
      });
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      lengths: {
        setTransform: 0,
        roundRect: 4,
        fillText: 3,
        strokeText: 3,
        createImageData: 1,
        getImageData: 4,
        arc: 5,
        measureText: 1,
        bezierCurveTo: 6,
        ellipse: 7,
        setLineDash: 1,
      },
      attrs: [['alpha', 'colorSpace', 'desynchronized', 'willReadFrequently'], true, 'srgb', false, false],
      matrix: [1, 1, 0, 0, true, true, '[object DOMMatrix]'],
      values: [false, false, false],
      dash: [[], true],
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('canvas rejects illegal construction, missing new, and borrowed WebIDL calls in the target Realm', async () => {
  const { engine, runtime } = await open('macos-chrome-v149');
  try {
    const result = runtime.run(`(() => {
      const failure = fn => { try { fn(); return null; } catch (error) { return [error instanceof TypeError, error.message]; } };
      const imageData = Object.getOwnPropertyDescriptor(ImageData.prototype, 'width').get;
      const metric = Object.getOwnPropertyDescriptor(TextMetrics.prototype, 'width').get;
      return JSON.stringify({
        constructors: [
          failure(() => new CanvasRenderingContext2D()),
          failure(() => new TextMetrics()),
          failure(() => new CanvasGradient()),
        ],
        calls: [failure(() => Path2D()), failure(() => ImageData(1, 1))],
        borrowed: [
          failure(() => HTMLCanvasElement.prototype.getContext.call({}, '2d')),
          failure(() => CanvasRenderingContext2D.prototype.fillRect.call({}, 0, 0, 1, 1)),
          failure(() => CanvasGradient.prototype.addColorStop.call({}, 0, '#fff')),
          failure(() => Path2D.prototype.arc.call({}, 0, 0, 1, 0, 1)),
          failure(() => imageData.call({})),
          failure(() => metric.call({})),
        ],
      });
    })()`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    assert.deepEqual(value.constructors, [
      [true, "Failed to construct 'CanvasRenderingContext2D': Illegal constructor"],
      [true, "Failed to construct 'TextMetrics': Illegal constructor"],
      [true, "Failed to construct 'CanvasGradient': Illegal constructor"],
    ]);
    assert.deepEqual(value.calls, [
      [true, "Failed to construct 'Path2D': Please use the 'new' operator, this DOM object constructor cannot be called as a function."],
      [true, "Failed to construct 'ImageData': Please use the 'new' operator, this DOM object constructor cannot be called as a function."],
    ]);
    for (const failure of value.borrowed) assert.deepEqual(failure, [true, 'Illegal invocation']);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('canvas context registry composes an independent provider without replacing getContext', async () => {
  const imported = await store.load('macos-chrome-v149');
  const { hash: _importedShapeHash, ...importedShapeBody } = imported.shape;
  const base = canvasShape(netShape(parseShape(seal({
    ...importedShapeBody,
    features: [],
    ops: [],
    support: { structure: imported.shape.support.structure || imported.shape.level },
  }))));
  const { hash: _shapeHash, ...shapeBody } = base;
  const shape = parseShape(seal({
    ...shapeBody,
    features: [...base.features, 'canvas-test'].sort(),
    ops: [
      ...base.ops,
      { op: 'alloc', id: 'canvas.test.proto', kind: 'object' },
      {
        op: 'alloc', id: 'canvas.test.get', kind: 'function', slot: 'canvas.test.get',
        shape: {
          name: 'getContext', length: 0, native: true, constructable: false,
          hasPrototype: false, keys: ['length', 'name'],
        },
      },
      {
        op: 'prop', target: { node: 'canvas.test.proto' }, key: { symbol: 'toStringTag' },
        desc: {
          kind: 'data', value: { json: 'TestWebGL' }, writable: false,
          enumerable: false, configurable: true,
        },
      },
      canvasContext('webgl', 'canvas.test.get'),
    ],
    support: { ...base.support, 'canvas.test': 'shape-only' },
  }));
  const fakeFeature: Feature = {
    id: 'canvas-test',
    rev: '1',
    requires: ['canvas'],
    build: () => ({ binds: [{ slot: 'canvas.test.get', driver: 'canvas-test' }] }),
  };
  const fakeDriver: Driver = {
    open: (port) => {
      const cache = new WeakMap<object, object>();
      return {
        call: (_config, self) => {
          if ((typeof self !== 'object' && typeof self !== 'function') || self === null) return null;
          let value = cache.get(self);
          if (!value) {
            value = port.make('canvas.test.proto') as object;
            cache.set(self, value);
          }
          return value;
        },
      };
    },
  };
  const { hash: _profileHash, ...profileBody } = imported.profile;
  const profile = parseProfile(seal({ ...profileBody, shape: { id: shape.id, hash: shape.hash } }));
  const engine = new JsdomEngine();
  const allDrivers = { ...drivers, 'canvas-test': fakeDriver };
  const plan = compile({
    profile,
    catalog: Catalog.create('builtin', [shape], [...features, fakeFeature]),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: Object.keys(allDrivers),
  });
  const runtime = engine.open(plan, allDrivers);
  try {
    const result = runtime.run(`(() => {
      const first = document.createElement('canvas');
      const second = document.createElement('canvas');
      const gl = first.getContext('webgl');
      return JSON.stringify({
        both: [!!second.getContext('2d'), !!gl],
        singleton: gl === first.getContext('webgl'),
        isolated: gl !== document.createElement('canvas').getContext('webgl'),
        exclusive: first.getContext('2d'),
        tag: Object.prototype.toString.call(gl),
        missing: first.getContext('webgl2'),
      });
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      both: [true, true], singleton: true, isolated: true, exclusive: null,
      tag: '[object TestWebGL]', missing: null,
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});
