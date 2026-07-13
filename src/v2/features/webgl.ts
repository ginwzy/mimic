import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Shape } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, ctor, fn, refProp, tag } from './ops.js';
import { canvasContext, canvasShape } from './canvas.js';

const GL1_PROTO = 'webgl.1.proto';
const GL2_PROTO = 'webgl.2.proto';
const DEBUG_PROTO = 'webgl.debug.proto';
const PRECISION_PROTO = 'webgl.precision.proto';
const INT32 = 'window.Int32Array';
const FLOAT32 = 'window.Float32Array';

const CONSTANTS = {
  VERSION: 7938,
  SHADING_LANGUAGE_VERSION: 35724,
  VENDOR: 7936,
  RENDERER: 7937,
  MAX_TEXTURE_SIZE: 3379,
  MAX_VIEWPORT_DIMS: 3386,
  MAX_RENDERBUFFER_SIZE: 34024,
  MAX_VERTEX_ATTRIBS: 34921,
  MAX_VERTEX_UNIFORM_VECTORS: 36347,
  MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
  MAX_VARYING_VECTORS: 36348,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661,
  MAX_TEXTURE_IMAGE_UNITS: 34930,
  MAX_CUBE_MAP_TEXTURE_SIZE: 34076,
  ALIASED_LINE_WIDTH_RANGE: 33902,
  ALIASED_POINT_SIZE_RANGE: 33901,
  FRAGMENT_SHADER: 35632,
  VERTEX_SHADER: 35633,
  LOW_FLOAT: 36336,
  MEDIUM_FLOAT: 36337,
  HIGH_FLOAT: 36338,
  LOW_INT: 36339,
  MEDIUM_INT: 36340,
  HIGH_INT: 36341,
} as const;

const TYPED: Readonly<Record<string, string>> = {
  '3386': INT32,
  '33901': FLOAT32,
  '33902': FLOAT32,
};

const DEBUG = {
  UNMASKED_VENDOR_WEBGL: 37445,
  UNMASKED_RENDERER_WEBGL: 37446,
} as const;

const ATTRS = {
  alpha: true,
  antialias: true,
  depth: true,
  desynchronized: false,
  failIfMajorPerformanceCaveat: false,
  powerPreference: 'default',
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  stencil: false,
  xrCompatible: false,
} as const;

function constant(target: { node: string }, key: string, value: number): DraftOp {
  return {
    op: 'prop', target, key,
    desc: { kind: 'data', value: { json: value }, writable: false, enumerable: true, configurable: false },
  };
}

function operations(): DraftOp[] {
  const gl1 = { node: GL1_PROTO } as const;
  const gl2 = { node: GL2_PROTO } as const;
  const debug = { node: DEBUG_PROTO } as const;
  const precision = { node: PRECISION_PROTO } as const;
  const ops: DraftOp[] = [
    { op: 'alloc', id: GL1_PROTO, kind: 'object' },
    { op: 'alloc', id: GL2_PROTO, kind: 'object' },
    { op: 'alloc', id: DEBUG_PROTO, kind: 'object' },
    { op: 'alloc', id: PRECISION_PROTO, kind: 'object' },
    ctor('webgl.1.ctor', 'webgl.1.ctor', 'WebGLRenderingContext', gl1),
    ctor('webgl.2.ctor', 'webgl.2.ctor', 'WebGL2RenderingContext', gl2),
    ctor('webgl.precision.ctor', 'webgl.precision.ctor', 'WebGLShaderPrecisionFormat', precision),
    fn('webgl.1.get', 'webgl.1.get', 'getContext'),
    fn('webgl.2.get', 'webgl.2.get', 'getContext'),
    fn('webgl.precision.min', 'webgl.precision.min', 'get rangeMin'),
    fn('webgl.precision.max', 'webgl.precision.max', 'get rangeMax'),
    fn('webgl.precision.value', 'webgl.precision.value', 'get precision'),
    refProp({ path: 'window' }, 'WebGLRenderingContext', 'webgl.1.ctor'),
    refProp({ path: 'window' }, 'WebGL2RenderingContext', 'webgl.2.ctor'),
    refProp({ path: 'window' }, 'WebGLShaderPrecisionFormat', 'webgl.precision.ctor'),
    canvasContext('webgl', 'webgl.1.get'),
    canvasContext('experimental-webgl', 'webgl.1.get'),
    canvasContext('webgl2', 'webgl.2.get'),
  ];
  for (const [name, value] of Object.entries(CONSTANTS)) {
    ops.push(constant(gl1, name, value), constant(gl2, name, value));
  }
  for (const [name, value] of Object.entries(DEBUG)) ops.push(constant(debug, name, value));
  ops.push(
    tag(debug, 'WebGLDebugRendererInfo'),
    { op: 'order', target: debug, keys: [...Object.keys(DEBUG), { symbol: 'toStringTag' }] },
  );
  ops.push(
    accessor(precision, 'rangeMin', 'webgl.precision.min'),
    accessor(precision, 'rangeMax', 'webgl.precision.max'),
    accessor(precision, 'precision', 'webgl.precision.value'),
    refProp(precision, 'constructor', 'webgl.precision.ctor'),
    tag(precision, 'WebGLShaderPrecisionFormat'),
    {
      op: 'order', target: precision,
      keys: ['rangeMin', 'rangeMax', 'precision', 'constructor', { symbol: 'toStringTag' }],
    },
  );
  for (const [target, prefix] of [[gl1, 'webgl.1'], [gl2, 'webgl.2']] as const) {
    ops.push(
      fn(`${prefix}.parameter`, `${prefix}.parameter`, 'getParameter', 1),
      fn(`${prefix}.extensions`, `${prefix}.extensions`, 'getSupportedExtensions'),
      fn(`${prefix}.extension`, `${prefix}.extension`, 'getExtension', 1),
      fn(`${prefix}.attributes`, `${prefix}.attributes`, 'getContextAttributes'),
      fn(`${prefix}.precision`, `${prefix}.precision`, 'getShaderPrecisionFormat', 2),
      fn(`${prefix}.canvas.get`, `${prefix}.canvas`, 'get canvas'),
      fn(`${prefix}.width.get`, `${prefix}.width`, 'get drawingBufferWidth'),
      fn(`${prefix}.height.get`, `${prefix}.height`, 'get drawingBufferHeight'),
      refProp(target, 'getParameter', `${prefix}.parameter`, true),
      refProp(target, 'getSupportedExtensions', `${prefix}.extensions`, true),
      refProp(target, 'getExtension', `${prefix}.extension`, true),
      refProp(target, 'getContextAttributes', `${prefix}.attributes`, true),
      refProp(target, 'getShaderPrecisionFormat', `${prefix}.precision`, true),
      accessor(target, 'canvas', `${prefix}.canvas.get`),
      accessor(target, 'drawingBufferWidth', `${prefix}.width.get`),
      accessor(target, 'drawingBufferHeight', `${prefix}.height.get`),
      refProp(target, 'constructor', target === gl1 ? 'webgl.1.ctor' : 'webgl.2.ctor'),
      tag(target, target === gl1 ? 'WebGLRenderingContext' : 'WebGL2RenderingContext'),
      {
        op: 'order', target,
        keys: [
          ...Object.keys(CONSTANTS), 'getParameter', 'getSupportedExtensions', 'getExtension',
          'getContextAttributes', 'getShaderPrecisionFormat', 'canvas', 'drawingBufferWidth',
          'drawingBufferHeight', 'constructor', { symbol: 'toStringTag' },
        ],
      },
    );
  }
  return ops;
}

export function webglShape(input: Shape): Shape {
  const shape = canvasShape(input);
  if (shape.features.includes('webgl')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'webgl'].sort(),
    ops: [...shape.ops, ...operations()],
    support: {
      ...shape.support,
      'webgl.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'webgl.api': 'shape-only',
    },
  }));
}

export const webglFeature: Feature = {
  id: 'webgl',
  rev: '1',
  requires: ['canvas'],
  build: ({ profile }) => {
    const enabled = profile.webgl !== undefined;
    const precision: Record<string, JsonValue> = Object.fromEntries(
      Object.entries(profile.webgl?.shaderPrecision ?? {}).map(([key, value]) => [key, { ...value }]),
    );
    return {
      binds: [
        { slot: 'webgl.1.get', driver: 'webgl', config: { op: 'context', enabled, proto: GL1_PROTO, type: 'webgl' } },
        { slot: 'webgl.2.get', driver: 'webgl', config: { op: 'context', enabled, proto: GL2_PROTO, type: 'webgl2' } },
        { slot: 'webgl.1.canvas', driver: 'webgl', config: { op: 'canvas' } },
        { slot: 'webgl.2.canvas', driver: 'webgl', config: { op: 'canvas' } },
        { slot: 'webgl.1.width', driver: 'webgl', config: { op: 'dimension', name: 'width' } },
        { slot: 'webgl.2.width', driver: 'webgl', config: { op: 'dimension', name: 'width' } },
        { slot: 'webgl.1.height', driver: 'webgl', config: { op: 'dimension', name: 'height' } },
        { slot: 'webgl.2.height', driver: 'webgl', config: { op: 'dimension', name: 'height' } },
        {
          slot: 'webgl.1.parameter', driver: 'webgl',
          config: {
            op: 'parameter',
            parameters: profile.webgl?.parameters ?? {},
            unmaskedVendor: profile.webgl?.unmaskedVendor ?? '',
            unmaskedRenderer: profile.webgl?.unmaskedRenderer ?? '',
          },
          sources: [INT32, FLOAT32],
        },
        {
          slot: 'webgl.2.parameter', driver: 'webgl',
          config: {
            op: 'parameter',
            parameters: profile.webgl?.parameters ?? {},
            unmaskedVendor: profile.webgl?.unmaskedVendor ?? '',
            unmaskedRenderer: profile.webgl?.unmaskedRenderer ?? '',
          },
          sources: [INT32, FLOAT32],
        },
        {
          slot: 'webgl.1.extensions', driver: 'webgl',
          config: { op: 'extensions', values: profile.webgl?.extensions ?? [] },
        },
        {
          slot: 'webgl.2.extensions', driver: 'webgl',
          config: { op: 'extensions', values: profile.webgl?.extensions ?? [] },
        },
        {
          slot: 'webgl.1.extension', driver: 'webgl',
          config: { op: 'extension', enabled, proto: DEBUG_PROTO },
        },
        {
          slot: 'webgl.2.extension', driver: 'webgl',
          config: { op: 'extension', enabled, proto: DEBUG_PROTO },
        },
        { slot: 'webgl.1.attributes', driver: 'webgl', config: { op: 'attributes' } },
        { slot: 'webgl.2.attributes', driver: 'webgl', config: { op: 'attributes' } },
        {
          slot: 'webgl.1.precision', driver: 'webgl',
          config: { op: 'precision', values: precision, proto: PRECISION_PROTO },
        },
        {
          slot: 'webgl.2.precision', driver: 'webgl',
          config: { op: 'precision', values: precision, proto: PRECISION_PROTO },
        },
        { slot: 'webgl.precision.min', driver: 'webgl', config: { op: 'precision-field', name: 'rangeMin' } },
        { slot: 'webgl.precision.max', driver: 'webgl', config: { op: 'precision-field', name: 'rangeMax' } },
        { slot: 'webgl.precision.value', driver: 'webgl', config: { op: 'precision-field', name: 'precision' } },
        { slot: 'webgl.1.ctor', driver: 'webgl', config: { op: 'illegal', name: 'WebGLRenderingContext' } },
        { slot: 'webgl.2.ctor', driver: 'webgl', config: { op: 'illegal', name: 'WebGL2RenderingContext' } },
        {
          slot: 'webgl.precision.ctor', driver: 'webgl',
          config: { op: 'illegal', name: 'WebGLShaderPrecisionFormat' },
        },
      ],
      support: {
        'webgl.data': enabled ? profile.evidence.webgl.support : 'unsupported',
        'webgl.runtime': enabled ? 'emulated' : 'unsupported',
        'webgl.render': 'unsupported',
      },
    };
  },
};

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || typeof value.op !== 'string') {
    throw new TypeError('webgl Driver config invalid');
  }
  return value;
}

function object(port: Port, value: unknown): object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw port.error('TypeError', 'Illegal invocation');
  }
  return value;
}

export const webglDriver: Driver = {
  open: (port) => {
    const caches = new Map<string, WeakMap<object, object>>();
    const owners = new WeakMap<object, object>();
    let debug: object | undefined;
    const precisions = new WeakMap<object, { rangeMin: number; rangeMax: number; precision: number }>();
    const int32 = port.source(INT32);
    const float32 = port.source(FLOAT32);
    if (typeof int32 !== 'function' || typeof float32 !== 'function') {
      throw new TypeError('webgl typed array source is not callable');
    }
    const context = (value: unknown): object => {
      const target = object(port, value);
      if (!owners.has(target)) throw port.error('TypeError', 'Illegal invocation');
      return target;
    };
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'context') {
          if (item.enabled !== true) return null;
          const owner = object(port, self);
          const type = String(item.type);
          let cache = caches.get(type);
          if (!cache) {
            cache = new WeakMap();
            caches.set(type, cache);
          }
          let context = cache.get(owner);
          if (!context) {
            context = object(port, port.make(String(item.proto)));
            cache.set(owner, context);
            owners.set(context, owner);
          }
          return context;
        }
        if (item.op === 'canvas') {
          const owner = owners.get(context(self));
          if (!owner) throw port.error('TypeError', 'Illegal invocation');
          return owner;
        }
        if (item.op === 'dimension') {
          const owner = owners.get(context(self));
          if (!owner) throw port.error('TypeError', 'Illegal invocation');
          return Number(Reflect.get(owner, String(item.name))) || 0;
        }
        if (item.op === 'parameter') {
          context(self);
          const parameters = item.parameters;
          if (parameters === null || Array.isArray(parameters) || typeof parameters !== 'object') {
            throw new TypeError('webgl parameter config invalid');
          }
          const key = String(args[0]);
          const special = key === '37445' ? item.unmaskedVendor : key === '37446' ? item.unmaskedRenderer : undefined;
          const value = special === undefined ? parameters[key] : special;
          if (value === undefined) return null;
          if (!Array.isArray(value)) return value;
          const ctor = TYPED[key] === INT32 ? int32 : float32;
          return Reflect.construct(ctor, [value]);
        }
        if (item.op === 'extensions') {
          context(self);
          if (!Array.isArray(item.values) || item.values.some((value) => typeof value !== 'string')) {
            throw new TypeError('webgl extensions config invalid');
          }
          return port.clone(item.values);
        }
        if (item.op === 'extension') {
          context(self);
          if (item.enabled !== true || args[0] !== 'WEBGL_debug_renderer_info') return null;
          debug ??= object(port, port.make(String(item.proto)));
          return debug;
        }
        if (item.op === 'attributes') {
          context(self);
          return port.clone(ATTRS);
        }
        if (item.op === 'precision') {
          context(self);
          const values = item.values;
          if (values === null || Array.isArray(values) || typeof values !== 'object') {
            throw new TypeError('webgl precision config invalid');
          }
          const value = values[`${String(args[0])}-${String(args[1])}`];
          if (value === null || Array.isArray(value) || typeof value !== 'object') return null;
          const rangeMin = value.rangeMin;
          const rangeMax = value.rangeMax;
          const precisionValue = value.precision;
          if (typeof rangeMin !== 'number' || typeof rangeMax !== 'number' || typeof precisionValue !== 'number') {
            throw new TypeError('webgl precision entry invalid');
          }
          const target = object(port, port.make(String(item.proto)));
          precisions.set(target, { rangeMin, rangeMax, precision: precisionValue });
          return target;
        }
        if (item.op === 'precision-field') {
          const value = precisions.get(object(port, self));
          const name = String(item.name) as 'rangeMin' | 'rangeMax' | 'precision';
          if (!value || !(name in value)) throw port.error('TypeError', 'Illegal invocation');
          return value[name];
        }
        if (item.op === 'illegal') {
          throw port.error('TypeError', `Failed to construct '${String(item.name)}': Illegal constructor`);
        }
        throw new TypeError(`webgl Driver op invalid:${String(item.op)}`);
      },
      construct: (raw) => {
        const item = config(raw);
        if (item.op === 'illegal') {
          throw port.error('TypeError', `Failed to construct '${String(item.name)}': Illegal constructor`);
        }
        throw new TypeError(`webgl Driver construct invalid:${String(item.op)}`);
      },
    };
  },
};
