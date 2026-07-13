import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { Data, JsonValue, Shape } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { fnShape, refProp } from './ops.js';

const EVAL = 'window.eval';
const FUNCTION = 'window.Function';

function operations(): DraftOp[] {
  return [
    {
      op: 'alloc', id: 'trace.eval', kind: 'function', slot: 'trace.eval',
      shape: fnShape('eval', 1),
    },
    {
      op: 'alloc', id: 'trace.Function', kind: 'function', slot: 'trace.Function',
      prototype: { path: 'window.Function.prototype' },
      shape: fnShape('Function', 1, true, true),
    },
    refProp({ path: 'window' }, 'eval', 'trace.eval'),
    refProp({ path: 'window' }, 'Function', 'trace.Function'),
    refProp({ path: 'window.Function.prototype' }, 'constructor', 'trace.Function'),
  ];
}

export function traceShape(input: Shape): Shape {
  if (input.features.includes('trace')) return input;
  const { hash: _hash, ...body } = input;
  return parseShape(seal({
    ...body,
    features: [...input.features, 'trace'].sort(),
    support: { ...input.support, 'trace.feature': 'emulated' },
  }));
}

export const traceFeature: Feature = {
  id: 'trace',
  rev: '1',
  build: ({ job }) => {
    if (!('trace' in job) || job.trace !== true) {
      return { support: { 'trace.capture': 'unsupported' } };
    }
    return {
      operations: operations(),
      binds: [
        { slot: 'trace.eval', driver: 'trace', config: { op: 'eval' }, sources: [EVAL] },
        { slot: 'trace.Function', driver: 'trace', config: { op: 'Function' }, sources: [FUNCTION] },
      ],
      support: { 'trace.capture': 'emulated' },
    };
  },
};

function config(value: JsonValue | undefined): 'eval' | 'Function' {
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || (value.op !== 'eval' && value.op !== 'Function')) {
    throw new TypeError('trace Driver config invalid');
  }
  return value.op;
}

function source(port: Port, path: string): Function {
  const value = port.source(path);
  if (typeof value !== 'function') throw new TypeError(`trace source is not callable:${path}`);
  return value;
}

function clean(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\bdebugger\b/g, '') : value;
}

function shown(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
  return `[${typeof value}]`;
}

export const traceDriver: Driver = {
  open: (port) => {
    const dynamicCode: Data[] = [];
    return {
      call: (raw, self, args) => {
        const op = config(raw);
        if (op === 'eval') {
          dynamicCode.push({ type: 'eval', code: shown(args[0]) });
          return Reflect.apply(source(port, EVAL), self, [clean(args[0])]);
        }
        dynamicCode.push({ type: 'Function', args: args.map(shown) });
        return Reflect.apply(source(port, FUNCTION), self, args.map(clean));
      },
      construct: (raw, args, newTarget) => {
        if (config(raw) !== 'Function') throw port.error('TypeError', 'eval is not a constructor');
        dynamicCode.push({ type: 'Function', args: args.map(shown) });
        return Reflect.construct(source(port, FUNCTION), args.map(clean), newTarget);
      },
      report: () => ({ dynamicCode: dynamicCode.map((entry) => ({ ...entry })) }),
      close: () => { dynamicCode.length = 0; },
    };
  },
};
