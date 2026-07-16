import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Shape } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import type { DraftOp, Feature, Ref } from '../shape/types.js';
import { accessor, ctor, fn, refProp, tag } from './ops.js';
import { domShape } from './dom.js';

const CONTEXTS = 'canvas.contexts';
const CONTEXT_PROTO = 'canvas.2d.proto';
const IMAGE_PROTO = 'canvas.image.proto';
const METRICS_PROTO = 'canvas.metrics.proto';
const GRADIENT_PROTO = 'canvas.gradient.proto';
const PATH_PROTO = 'canvas.path.proto';
const MATRIX_PROTO = 'canvas.matrix.proto';
const CLAMPED = 'window.Uint8ClampedArray';
const HTML_CANVAS = 'window.HTMLCanvasElement';

type Method = readonly [name: string, length: number];

const VOID_METHODS: readonly Method[] = [
  ['clearRect', 4], ['fillRect', 4], ['strokeRect', 4], ['fillText', 3], ['strokeText', 3],
  ['beginPath', 0], ['closePath', 0], ['moveTo', 2], ['lineTo', 2], ['arc', 5], ['rect', 4],
  ['fill', 0], ['stroke', 0], ['save', 0], ['restore', 0], ['translate', 2], ['rotate', 1],
  ['scale', 2], ['transform', 6], ['setTransform', 0], ['resetTransform', 0],
  ['bezierCurveTo', 6], ['quadraticCurveTo', 4], ['arcTo', 5], ['ellipse', 7], ['roundRect', 4],
  ['clip', 0], ['setLineDash', 1], ['drawImage', 3], ['putImageData', 3], ['reset', 0],
];

const VALUE_METHODS: readonly Method[] = [
  ['getContextAttributes', 0], ['getTransform', 0], ['isContextLost', 0],
  ['isPointInPath', 2], ['isPointInStroke', 2], ['getLineDash', 0],
];

const PATH_METHODS: readonly Method[] = [
  ['addPath', 1], ['moveTo', 2], ['lineTo', 2], ['bezierCurveTo', 6], ['quadraticCurveTo', 4],
  ['arc', 5], ['arcTo', 5], ['ellipse', 7], ['rect', 4], ['roundRect', 4], ['closePath', 0],
];

const GRADIENT_METHODS: readonly Method[] = [
  ['createLinearGradient', 4], ['createRadialGradient', 6], ['createConicGradient', 3],
];

const STYLES = {
  fillStyle: '#000000',
  strokeStyle: '#000000',
  globalAlpha: 1,
  lineWidth: 1,
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
} as const;

const IMAGE_FIELDS = ['data', 'width', 'height', 'colorSpace'] as const;
const METRIC_FIELDS = [
  'width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'fontBoundingBoxAscent',
  'fontBoundingBoxDescent', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent',
  'emHeightAscent', 'emHeightDescent', 'hangingBaseline', 'alphabeticBaseline', 'ideographicBaseline',
] as const;

export function canvasContext(type: string, provider: string): DraftOp {
  if (type.length === 0 || provider.length === 0) throw new TypeError('canvas context provider invalid');
  return {
    op: 'prop', target: { node: CONTEXTS }, key: type,
    desc: {
      kind: 'data', value: { ref: { node: provider } },
      writable: false, enumerable: false, configurable: true,
    },
  };
}

function operations(): DraftOp[] {
  const contexts = { node: CONTEXTS } as const;
  const context = { node: CONTEXT_PROTO } as const;
  const image = { node: IMAGE_PROTO } as const;
  const metrics = { node: METRICS_PROTO } as const;
  const gradient = { node: GRADIENT_PROTO } as const;
  const path = { node: PATH_PROTO } as const;
  const matrix = { node: MATRIX_PROTO } as const;
  const canvas = { path: 'window.HTMLCanvasElement.prototype' } as const;
  const ops: DraftOp[] = [
    { op: 'alloc', id: CONTEXTS, kind: 'object' },
    { op: 'proto', target: contexts, value: null },
    { op: 'alloc', id: CONTEXT_PROTO, kind: 'object' },
    { op: 'alloc', id: IMAGE_PROTO, kind: 'object' },
    { op: 'alloc', id: METRICS_PROTO, kind: 'object' },
    { op: 'alloc', id: GRADIENT_PROTO, kind: 'object' },
    { op: 'alloc', id: PATH_PROTO, kind: 'object' },
    { op: 'alloc', id: MATRIX_PROTO, kind: 'object' },
    ctor('canvas.2d.ctor', 'canvas.2d.ctor', 'CanvasRenderingContext2D', context),
    ctor('canvas.image.ctor', 'canvas.image.ctor', 'ImageData', image),
    ctor('canvas.metrics.ctor', 'canvas.metrics.ctor', 'TextMetrics', metrics),
    ctor('canvas.gradient.ctor', 'canvas.gradient.ctor', 'CanvasGradient', gradient),
    ctor('canvas.path.ctor', 'canvas.path.ctor', 'Path2D', path),
    fn('canvas.get', 'canvas.get', 'getContext', 1),
    fn('canvas.2d.get', 'canvas.2d.get', 'getContext', 0),
    fn('canvas.url', 'canvas.url', 'toDataURL'),
    fn('canvas.context.canvas.get', 'canvas.context.canvas', 'get canvas'),
    fn('canvas.context.image', 'canvas.context.image', 'getImageData', 4),
    fn('canvas.context.create-image', 'canvas.context.create-image', 'createImageData', 1),
    fn('canvas.context.measure', 'canvas.context.measure', 'measureText', 1),
    refProp({ path: 'window' }, 'CanvasRenderingContext2D', 'canvas.2d.ctor'),
    refProp({ path: 'window' }, 'ImageData', 'canvas.image.ctor'),
    refProp({ path: 'window' }, 'TextMetrics', 'canvas.metrics.ctor'),
    refProp({ path: 'window' }, 'CanvasGradient', 'canvas.gradient.ctor'),
    refProp({ path: 'window' }, 'Path2D', 'canvas.path.ctor'),
    refProp(context, 'constructor', 'canvas.2d.ctor'),
    refProp(image, 'constructor', 'canvas.image.ctor'),
    refProp(metrics, 'constructor', 'canvas.metrics.ctor'),
    refProp(gradient, 'constructor', 'canvas.gradient.ctor'),
    refProp(path, 'constructor', 'canvas.path.ctor'),
    tag(context, 'CanvasRenderingContext2D'),
    tag(image, 'ImageData'),
    tag(metrics, 'TextMetrics'),
    tag(gradient, 'CanvasGradient'),
    tag(path, 'Path2D'),
    tag(matrix, 'DOMMatrix'),
    refProp(canvas, 'getContext', 'canvas.get', true),
    refProp(canvas, 'toDataURL', 'canvas.url', true),
    canvasContext('2d', 'canvas.2d.get'),
    accessor(context, 'canvas', 'canvas.context.canvas.get'),
    refProp(context, 'getImageData', 'canvas.context.image', true),
    refProp(context, 'createImageData', 'canvas.context.create-image', true),
    refProp(context, 'measureText', 'canvas.context.measure', true),
  ];

  for (const [name, length] of VOID_METHODS) {
    const id = `canvas.context.${name}`;
    ops.push(fn(id, id, name, length), refProp(context, name, id, true));
  }
  for (const [name, length] of GRADIENT_METHODS) {
    const id = `canvas.context.${name}`;
    ops.push(fn(id, id, name, length), refProp(context, name, id, true));
  }
  for (const [name, length] of VALUE_METHODS) {
    const id = `canvas.context.${name}`;
    ops.push(fn(id, id, name, length), refProp(context, name, id, true));
  }
  ops.push(
    fn('canvas.gradient.add', 'canvas.gradient.add', 'addColorStop', 2),
    refProp(gradient, 'addColorStop', 'canvas.gradient.add', true),
  );
  for (const [name, length] of PATH_METHODS) {
    const id = `canvas.path.${name}`;
    ops.push(fn(id, id, name, length), refProp(path, name, id, true));
  }
  for (const name of Object.keys(STYLES)) {
    const get = `canvas.context.${name}.get`;
    const set = `canvas.context.${name}.set`;
    ops.push(fn(get, get, `get ${name}`), fn(set, set, `set ${name}`, 1), accessor(context, name, get, set));
  }
  for (const name of IMAGE_FIELDS) {
    const get = `canvas.image.${name}.get`;
    ops.push(fn(get, get, `get ${name}`), accessor(image, name, get));
  }
  for (const name of METRIC_FIELDS) {
    const get = `canvas.metrics.${name}.get`;
    ops.push(fn(get, get, `get ${name}`), accessor(metrics, name, get));
  }
  ops.push(
    {
      op: 'order', target: context,
      keys: [
        'canvas', 'getImageData', 'createImageData', 'measureText',
        ...VOID_METHODS.map(([name]) => name), ...GRADIENT_METHODS.map(([name]) => name),
        ...VALUE_METHODS.map(([name]) => name), ...Object.keys(STYLES),
        'constructor', { symbol: 'toStringTag' },
      ],
    },
    { op: 'order', target: image, keys: [...IMAGE_FIELDS, 'constructor', { symbol: 'toStringTag' }] },
    { op: 'order', target: metrics, keys: [...METRIC_FIELDS, 'constructor', { symbol: 'toStringTag' }] },
    { op: 'order', target: gradient, keys: ['addColorStop', 'constructor', { symbol: 'toStringTag' }] },
    {
      op: 'order', target: path,
      keys: [...PATH_METHODS.map(([name]) => name), 'constructor', { symbol: 'toStringTag' }],
    },
    { op: 'order', target: matrix, keys: [{ symbol: 'toStringTag' }] },
  );
  return ops;
}

export function canvasShape(input: Shape): Shape {
  const shape = domShape(input);
  if (shape.features.includes('canvas')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'canvas'].sort(),
    ops: [...shape.ops, ...operations()],
    support: {
      ...shape.support,
      'canvas.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'canvas.2d': 'shape-only',
    },
  }));
}

export const canvasFeature: Feature = {
  id: 'canvas',
  rev: '1',
  requires: ['dom'],
  build: () => ({
    binds: [
      {
        slot: 'canvas.get', driver: 'canvas', config: { op: 'get', registry: CONTEXTS },
        sources: [HTML_CANVAS],
      },
      { slot: 'canvas.2d.get', driver: 'canvas', config: { op: 'context', proto: CONTEXT_PROTO } },
      { slot: 'canvas.url', driver: 'canvas', config: { op: 'url' } },
      { slot: 'canvas.context.canvas', driver: 'canvas', config: { op: 'canvas' } },
      {
        slot: 'canvas.context.image', driver: 'canvas', config: { op: 'image-get', proto: IMAGE_PROTO },
        sources: [CLAMPED],
      },
      { slot: 'canvas.context.create-image', driver: 'canvas', config: { op: 'image-create', proto: IMAGE_PROTO } },
      { slot: 'canvas.context.measure', driver: 'canvas', config: { op: 'metrics', proto: METRICS_PROTO } },
      { slot: 'canvas.image.ctor', driver: 'canvas', config: { op: 'image-ctor', proto: IMAGE_PROTO } },
      {
        slot: 'canvas.2d.ctor', driver: 'canvas',
        config: { op: 'illegal', name: 'CanvasRenderingContext2D' },
      },
      { slot: 'canvas.metrics.ctor', driver: 'canvas', config: { op: 'illegal', name: 'TextMetrics' } },
      { slot: 'canvas.gradient.ctor', driver: 'canvas', config: { op: 'illegal', name: 'CanvasGradient' } },
      { slot: 'canvas.path.ctor', driver: 'canvas', config: { op: 'path-ctor', proto: PATH_PROTO } },
      ...VOID_METHODS.map(([name]) => ({
        slot: `canvas.context.${name}`, driver: 'canvas', config: { op: 'void' },
      })),
      ...GRADIENT_METHODS.map(([name]) => ({
        slot: `canvas.context.${name}`, driver: 'canvas', config: { op: 'gradient', proto: GRADIENT_PROTO },
      })),
      { slot: 'canvas.context.getContextAttributes', driver: 'canvas', config: { op: 'attributes' } },
      { slot: 'canvas.context.getTransform', driver: 'canvas', config: { op: 'matrix', proto: MATRIX_PROTO } },
      { slot: 'canvas.context.isContextLost', driver: 'canvas', config: { op: 'false' } },
      { slot: 'canvas.context.isPointInPath', driver: 'canvas', config: { op: 'false' } },
      { slot: 'canvas.context.isPointInStroke', driver: 'canvas', config: { op: 'false' } },
      { slot: 'canvas.context.getLineDash', driver: 'canvas', config: { op: 'dash' } },
      { slot: 'canvas.gradient.add', driver: 'canvas', config: { op: 'gradient-add' } },
      ...PATH_METHODS.map(([name]) => ({
        slot: `canvas.path.${name}`, driver: 'canvas', config: { op: 'path-method' },
      })),
      ...Object.entries(STYLES).flatMap(([name, initial]) => ([
        { slot: `canvas.context.${name}.get`, driver: 'canvas', config: { op: 'style-get', name, initial } },
        { slot: `canvas.context.${name}.set`, driver: 'canvas', config: { op: 'style-set', name } },
      ])),
      ...IMAGE_FIELDS.map((name) => ({
        slot: `canvas.image.${name}.get`, driver: 'canvas', config: { op: 'image-field', name },
      })),
      ...METRIC_FIELDS.map((name) => ({
        slot: `canvas.metrics.${name}.get`, driver: 'canvas', config: { op: 'metric-field', name },
      })),
    ],
    support: { 'canvas.runtime': 'shape-only' },
  }),
};

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || typeof value.op !== 'string') {
    throw new TypeError('canvas Driver config invalid');
  }
  return value;
}

function object(port: Port, value: unknown): object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw port.error('TypeError', 'Illegal invocation');
  }
  return value;
}

function made(port: Port, proto: JsonValue | undefined): object {
  const value = port.make(String(proto));
  return object(port, value);
}

function positive(value: unknown, port: Port): number {
  const number = Number(value);
  const integer = Math.trunc(number);
  if (!Number.isFinite(number) || integer <= 0) throw port.error('RangeError', 'The source width is 0.');
  return integer;
}

interface ImageState {
  data: unknown;
  width: number;
  height: number;
  colorSpace: string;
}

type MetricState = Record<(typeof METRIC_FIELDS)[number], number>;

export const canvasDriver: Driver = {
  open: (port) => {
    const contexts = new WeakMap<object, object>();
    const families = new WeakMap<object, Function>();
    const owners = new WeakMap<object, object>();
    const styles = new WeakMap<object, Map<string, unknown>>();
    const images = new WeakMap<object, ImageState>();
    const metrics = new WeakMap<object, MetricState>();
    const gradients = new WeakSet<object>();
    const paths = new WeakSet<object>();
    const htmlCanvas = port.source(HTML_CANVAS);
    if (typeof htmlCanvas !== 'function') throw new TypeError('canvas HTMLCanvasElement source is not callable');

    const canvas = (value: unknown): object => {
      const target = object(port, value);
      if (!Reflect.apply(Function.prototype[Symbol.hasInstance], htmlCanvas, [target])) {
        throw port.error('TypeError', 'Illegal invocation');
      }
      return target;
    };

    const context = (value: unknown): object => {
      const target = object(port, value);
      if (!owners.has(target)) throw port.error('TypeError', 'Illegal invocation');
      return target;
    };
    const image = (proto: JsonValue | undefined, width: unknown, height: unknown): object => {
      const w = positive(width, port);
      const h = positive(height, port);
      const ctor = port.source(CLAMPED);
      if (typeof ctor !== 'function') throw new TypeError('canvas Uint8ClampedArray source is not callable');
      const target = made(port, proto);
      images.set(target, { data: Reflect.construct(ctor, [w * h * 4]), width: w, height: h, colorSpace: 'srgb' });
      return target;
    };
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'get') {
          const target = canvas(self);
          const provider = Reflect.get(object(port, port.node(String(item.registry))), String(args[0]));
          if (typeof provider !== 'function') return null;
          const family = families.get(target);
          if (family && family !== provider) return null;
          const value = Reflect.apply(provider, target, args.slice(1));
          if (value !== null && value !== undefined) families.set(target, provider);
          return value;
        }
        if (item.op === 'context') {
          const owner = canvas(self);
          let context = contexts.get(owner);
          if (!context) {
            context = made(port, item.proto);
            contexts.set(owner, context);
            owners.set(context, owner);
          }
          return context;
        }
        if (item.op === 'canvas') {
          const target = context(self);
          const canvas = owners.get(target);
          if (!canvas) throw port.error('TypeError', 'Illegal invocation');
          return canvas;
        }
        if (item.op === 'void') {
          context(self);
          return undefined;
        }
        if (item.op === 'gradient') {
          context(self);
          const target = made(port, item.proto);
          gradients.add(target);
          return target;
        }
        if (item.op === 'attributes') {
          context(self);
          return port.clone({ alpha: true, colorSpace: 'srgb', desynchronized: false, willReadFrequently: false });
        }
        if (item.op === 'matrix') {
          context(self);
          const target = made(port, item.proto);
          const values = {
            a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
            m11: 1, m12: 0, m13: 0, m14: 0, m21: 0, m22: 1, m23: 0, m24: 0,
            m31: 0, m32: 0, m33: 1, m34: 0, m41: 0, m42: 0, m43: 0, m44: 1,
            is2D: true, isIdentity: true,
          };
          for (const [name, value] of Object.entries(values)) Reflect.defineProperty(target, name, {
            value, writable: true, enumerable: true, configurable: true,
          });
          return target;
        }
        if (item.op === 'false') {
          context(self);
          return false;
        }
        if (item.op === 'dash') {
          context(self);
          return port.clone([]);
        }
        if (item.op === 'gradient-add') {
          if (!gradients.has(object(port, self))) throw port.error('TypeError', 'Illegal invocation');
          return undefined;
        }
        if (item.op === 'path-method') {
          if (!paths.has(object(port, self))) throw port.error('TypeError', 'Illegal invocation');
          return undefined;
        }
        if (item.op === 'style-get') {
          const target = context(self);
          return styles.get(target)?.get(String(item.name)) ?? item.initial;
        }
        if (item.op === 'style-set') {
          const target = context(self);
          let values = styles.get(target);
          if (!values) {
            values = new Map();
            styles.set(target, values);
          }
          values.set(String(item.name), args[0]);
          return undefined;
        }
        if (item.op === 'image-get') {
          context(self);
          return image(item.proto, args[2], args[3]);
        }
        if (item.op === 'image-create') {
          context(self);
          return image(item.proto, args[0], args[1]);
        }
        if (item.op === 'image-field') {
          const state = images.get(object(port, self));
          if (!state || !(String(item.name) in state)) throw port.error('TypeError', 'Illegal invocation');
          return state[String(item.name) as keyof ImageState];
        }
        if (item.op === 'metrics') {
          const ctx = context(self);
          const target = made(port, item.proto);
          const text = String(args[0] ?? '');
          // Derive metrics from current font size (default 10px) — zero bounding boxes
          // are a jsdom-era tell; Chrome returns non-zero ascent/descent for normal fonts.
          const font = String(styles.get(ctx)?.get('font') ?? '10px sans-serif');
          const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(font);
          const size = sizeMatch ? Number(sizeMatch[1]) : 10;
          const width = text.length * size * 0.55;
          const ascent = size * 0.8;
          const descent = size * 0.2;
          const state = {
            width,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: width,
            fontBoundingBoxAscent: ascent,
            fontBoundingBoxDescent: descent,
            actualBoundingBoxAscent: ascent,
            actualBoundingBoxDescent: descent,
            emHeightAscent: ascent,
            emHeightDescent: descent,
            hangingBaseline: ascent * 0.8,
            alphabeticBaseline: 0,
            ideographicBaseline: -descent,
          } satisfies MetricState;
          metrics.set(target, state);
          return target;
        }
        if (item.op === 'metric-field') {
          const state = metrics.get(object(port, self));
          if (!state || !(String(item.name) in state)) throw port.error('TypeError', 'Illegal invocation');
          return state[String(item.name) as keyof MetricState];
        }
        if (item.op === 'url') {
          canvas(self);
          const requested = typeof args[0] === 'string' ? args[0].toLowerCase() : 'image/png';
          const type = ['image/png', 'image/jpeg', 'image/webp'].includes(requested) ? requested : 'image/png';
          return `data:${type};base64,`;
        }
        if (item.op === 'illegal') {
          throw port.error('TypeError', `Failed to construct '${String(item.name)}': Illegal constructor`);
        }
        if (item.op === 'image-ctor' || item.op === 'path-ctor') {
          const name = item.op === 'image-ctor' ? 'ImageData' : 'Path2D';
          throw port.error('TypeError', `Failed to construct '${name}': Please use the 'new' operator, this DOM object constructor cannot be called as a function.`);
        }
        throw new TypeError(`canvas Driver op invalid:${String(item.op)}`);
      },
      construct: (raw, args) => {
        const item = config(raw);
        if (item.op === 'image-ctor') return image(item.proto, args[0], args[1]);
        if (item.op === 'path-ctor') {
          const target = made(port, item.proto);
          paths.add(target);
          return target;
        }
        if (item.op === 'illegal') {
          throw port.error('TypeError', `Failed to construct '${String(item.name)}': Illegal constructor`);
        }
        throw new TypeError(`canvas Driver construct invalid:${String(item.op)}`);
      },
    };
  },
};
