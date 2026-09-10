import { describeCoverage } from './capabilities.js';
import type { JsonValue } from '../core/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, ctor, fn, refProp, tag } from './ops.js';
import { canvasContext } from './canvas.compile.js';
import { INT32, FLOAT32 } from './webgl.shared.js';

const GL1_PROTO = 'webgl.1.proto';
const GL2_PROTO = 'webgl.2.proto';
const DEBUG_PROTO = 'webgl.debug.proto';
const PRECISION_PROTO = 'webgl.precision.proto';
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

const DEBUG = {
  UNMASKED_VENDOR_WEBGL: 37445,
  UNMASKED_RENDERER_WEBGL: 37446,
} as const;

function constant(target: { node: string }, key: string, value: number): DraftOp {
  return {
    op: 'prop', target, key,
    desc: { kind: 'data', value: { json: value }, writable: false, enumerable: true, configurable: false },
  };
}

export function operations(): DraftOp[] {
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

export const webglFeature: Feature = {
  id: 'webgl',
  jobKeys: [],
  describe: ({ profile }, support) => describeCoverage(support, {
    'webgl.api': profile.webgl ? 'partial' : 'structure',
    'webgl.data': 'constant',
    'webgl.runtime': 'partial',
    'webgl.render': 'none',
  }),
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
