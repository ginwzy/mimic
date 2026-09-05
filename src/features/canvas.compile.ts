import { describeCoverage } from './capabilities.js';
import { legacyOrigin } from '../core/capabilities.js';
import { createHash } from 'node:crypto';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, ctor, fn, refProp, tag } from './ops.js';
import { HTML_CANVAS, CLAMPED, METRIC_FIELDS } from './canvas.shared.js';
import { EMPTY_CANVAS_DATA_URL, IDENTITY_POLICY_REVISION, resolveCanvasURLs } from '../environment/identity.js';

/** SHA-256 hex of a toDataURL string (same primitive as BMS kH). */
export function canvasFingerprintHex(dataURL: string): string {
  return createHash('sha256').update(dataURL).digest('hex');
}

const CONTEXTS = 'canvas.contexts';
const CONTEXT_PROTO = 'canvas.2d.proto';
const IMAGE_PROTO = 'canvas.image.proto';
const METRICS_PROTO = 'canvas.metrics.proto';
const GRADIENT_PROTO = 'canvas.gradient.proto';
const PATH_PROTO = 'canvas.path.proto';
const MATRIX_PROTO = 'canvas.matrix.proto';

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

export function operations(): DraftOp[] {
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

export const canvasFeature: Feature = {
  id: 'canvas',
  describe: ({ profile }, support) => describeCoverage(support, {
    'canvas.2d': 'partial',
    'canvas.runtime': 'partial',
    'canvas.fingerprint': 'constant',
  }, { 'canvas.fingerprint': profile.canvas?.toDataURL.startsWith('data:image/png')
    && profile.canvas.toDataURL.length > EMPTY_CANVAS_DATA_URL.length ? legacyOrigin(profile.evidence.canvas.support) : 'synthetic' }),
  rev: '3',
  requires: ['dom'],
  build: ({ profile }) => {
    const dataURLs = resolveCanvasURLs(profile);
    const fromProfile = profile.canvas !== undefined
      && typeof profile.canvas.toDataURL === 'string'
      && profile.canvas.toDataURL.length > EMPTY_CANVAS_DATA_URL.length;
    return {
      binds: [
        {
          slot: 'canvas.get', driver: 'canvas', config: { op: 'get', registry: CONTEXTS },
          sources: [HTML_CANVAS],
        },
        { slot: 'canvas.2d.get', driver: 'canvas', config: { op: 'context', proto: CONTEXT_PROTO } },
        {
          slot: 'canvas.url', driver: 'canvas',
          config: { op: 'url', policy: IDENTITY_POLICY_REVISION, dataURLs },
        },
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
      support: {
        'canvas.runtime': 'emulated',
        'canvas.fingerprint': fromProfile ? 'captured' : 'derived',
      },
    };
  },
};
