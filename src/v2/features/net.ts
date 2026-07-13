import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { Data, JsonValue, Shape } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { domShape } from './dom.js';
import { accessor, fn, fnShape, refProp, tag } from './ops.js';

const XHR = 'window.XMLHttpRequest';
const XHR_SEND = 'window.XMLHttpRequest.prototype.send';
const NAV = 'window.Navigator';
const BEACON = 'window.Navigator.prototype.sendBeacon';
const FETCH = 'window.fetch';
const ARRAY_BUFFER = 'window.ArrayBuffer';
const RESPONSE_PROTO = 'net.response.proto';

type Via = 'xhr' | 'beacon' | 'fetch';
type Mode = 'capture' | 'forward';

interface Post extends Data {
  via: Via;
  tag: string;
  len: number;
  body: string | null;
}

type Config =
  | { op: 'request'; via: Via; mode: Mode }
  | { op: 'response-ctor' }
  | { op: 'response-field'; field: 'ok' | 'status' | 'statusText' }
  | { op: 'response-body'; kind: 'text' | 'json' | 'arrayBuffer' };

function operations(): DraftOp[] {
  return [
    { op: 'alloc', id: RESPONSE_PROTO, kind: 'object' },
    {
      op: 'alloc', id: 'net.response.ctor', kind: 'function', slot: 'net.response.ctor',
      shape: fnShape('Response', 0, true, true), prototype: { node: RESPONSE_PROTO },
    },
    fn('net.xhr', 'net.xhr', 'send'),
    fn('net.beacon', 'net.beacon', 'sendBeacon', 1),
    fn('net.fetch', 'net.fetch', 'fetch', 1),
    fn('net.response.ok', 'net.response.ok', 'get ok'),
    fn('net.response.status', 'net.response.status', 'get status'),
    fn('net.response.status-text', 'net.response.statusText', 'get statusText'),
    fn('net.response.text', 'net.response.text', 'text'),
    fn('net.response.json', 'net.response.json', 'json'),
    fn('net.response.array-buffer', 'net.response.arrayBuffer', 'arrayBuffer'),
    { op: 'proto', target: { node: RESPONSE_PROTO }, value: { path: 'window.Object.prototype' } },
    refProp({ path: 'window' }, 'Response', 'net.response.ctor'),
    refProp({ node: RESPONSE_PROTO }, 'constructor', 'net.response.ctor'),
    tag({ node: RESPONSE_PROTO }, 'Response'),
    accessor({ node: RESPONSE_PROTO }, 'ok', 'net.response.ok'),
    accessor({ node: RESPONSE_PROTO }, 'status', 'net.response.status'),
    accessor({ node: RESPONSE_PROTO }, 'statusText', 'net.response.status-text'),
    refProp({ node: RESPONSE_PROTO }, 'text', 'net.response.text', true),
    refProp({ node: RESPONSE_PROTO }, 'json', 'net.response.json', true),
    refProp({ node: RESPONSE_PROTO }, 'arrayBuffer', 'net.response.array-buffer', true),
    refProp({ path: 'window.XMLHttpRequest.prototype' }, 'send', 'net.xhr', true),
    refProp({ path: 'window.Navigator.prototype' }, 'sendBeacon', 'net.beacon', true),
    refProp({ path: 'window' }, 'fetch', 'net.fetch', true),
    {
      op: 'order', target: { node: RESPONSE_PROTO },
      keys: ['ok', 'status', 'statusText', 'text', 'json', 'arrayBuffer', 'constructor', { symbol: 'toStringTag' }],
    },
  ];
}

export function netShape(input: Shape): Shape {
  const shape = domShape(input);
  if (shape.features.includes('net')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'net'].sort(),
    ops: [...shape.ops, ...operations()],
    support: {
      ...shape.support,
      'net.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'net.api': 'emulated',
    },
  }));
}

export const netFeature: Feature = {
  id: 'net',
  rev: '1',
  requires: ['dom'],
  build: ({ job }) => {
    const mode: Mode = job.kind === 'capture' ? 'capture' : 'forward';
    return {
      binds: [
        {
          slot: 'net.xhr', driver: 'net', config: { op: 'request', via: 'xhr', mode },
          sources: [XHR, XHR_SEND],
        },
        {
          slot: 'net.beacon', driver: 'net', config: { op: 'request', via: 'beacon', mode },
          sources: [NAV, BEACON],
        },
        {
          slot: 'net.fetch', driver: 'net', config: { op: 'request', via: 'fetch', mode },
          sources: [FETCH],
        },
        { slot: 'net.response.ctor', driver: 'net', config: { op: 'response-ctor' } },
        { slot: 'net.response.ok', driver: 'net', config: { op: 'response-field', field: 'ok' } },
        { slot: 'net.response.status', driver: 'net', config: { op: 'response-field', field: 'status' } },
        { slot: 'net.response.statusText', driver: 'net', config: { op: 'response-field', field: 'statusText' } },
        { slot: 'net.response.text', driver: 'net', config: { op: 'response-body', kind: 'text' } },
        { slot: 'net.response.json', driver: 'net', config: { op: 'response-body', kind: 'json' } },
        {
          slot: 'net.response.arrayBuffer', driver: 'net', config: { op: 'response-body', kind: 'arrayBuffer' },
          sources: [ARRAY_BUFFER],
        },
      ],
      support: {
        'net.capture': mode === 'capture' ? 'emulated' : 'unsupported',
        'net.forward': mode === 'forward' ? 'emulated' : 'unsupported',
      },
    };
  },
};

function config(value: JsonValue | undefined): Config {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || typeof value.op !== 'string') {
    throw new TypeError('net Driver config invalid');
  }
  if (value.op === 'request'
    && (value.via === 'xhr' || value.via === 'beacon' || value.via === 'fetch')
    && (value.mode === 'capture' || value.mode === 'forward')) {
    return { op: 'request', via: value.via, mode: value.mode };
  }
  if (value.op === 'response-ctor') return { op: 'response-ctor' };
  if (value.op === 'response-field' && (value.field === 'ok' || value.field === 'status' || value.field === 'statusText')) {
    return { op: 'response-field', field: value.field };
  }
  if (value.op === 'response-body' && (value.kind === 'text' || value.kind === 'json' || value.kind === 'arrayBuffer')) {
    return { op: 'response-body', kind: value.kind };
  }
  throw new TypeError('net Driver config invalid');
}

function callable(port: Port, path: string): Function | undefined {
  const value = port.source(path);
  return typeof value === 'function' ? value : undefined;
}

function instance(port: Port, value: unknown, path: string): void {
  const ctor = callable(port, path);
  if (!ctor || (typeof value !== 'object' && typeof value !== 'function') || value === null
    || !Function.prototype[Symbol.hasInstance].call(ctor, value)) {
    throw port.error('TypeError', 'Illegal invocation');
  }
}

function requestBody(via: Via, args: readonly unknown[]): unknown {
  if (via === 'xhr') return args[0];
  if (via === 'beacon') return args[1];
  const init = args[1];
  try {
    return (typeof init === 'object' && init !== null) || typeof init === 'function'
      ? Reflect.get(init, 'body')
      : undefined;
  } catch {
    return undefined;
  }
}

function post(via: Via, value: unknown): Post {
  let tag = '[object Unknown]';
  let len = 0;
  let body: string | null = null;
  try {
    tag = Object.prototype.toString.call(value);
  } catch {
    // A hostile toStringTag must not abort request capture.
  }
  try {
    if (value != null) {
      if (typeof value === 'string') {
        body = value;
        len = value.length;
      } else {
        const bytes = Reflect.get(Object(value), 'byteLength');
        const length = bytes === undefined ? Reflect.get(Object(value), 'length') : bytes;
        if (typeof length === 'number' && Number.isFinite(length) && length >= 0) {
          len = Math.floor(length);
        } else {
          body = String(value);
          len = body.length;
        }
      }
    }
  } catch {
    len = 0;
    body = null;
  }
  return { via, tag, len, body };
}

export const netDriver: Driver = {
  open: (port) => {
    const posts: Post[] = [];
    let responses = new WeakSet<object>();
    const response = (): object => {
      const value = port.make(RESPONSE_PROTO);
      if (value === null || typeof value !== 'object') throw new TypeError('net Response allocation failed');
      responses.add(value);
      return value;
    };
    const responseSelf = (self: unknown): object => {
      if ((typeof self !== 'object' && typeof self !== 'function') || self === null || !responses.has(self)) {
        throw port.error('TypeError', 'Illegal invocation');
      }
      return self;
    };
    const resolvedResponse = () => {
      const value = response();
      return port.resolve().then(() => value);
    };
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'response-ctor') {
          throw port.error('TypeError', "Failed to construct 'Response': Please use the 'new' operator.");
        }
        if (item.op === 'response-field') {
          responseSelf(self);
          if (item.field === 'ok') return true;
          return item.field === 'status' ? 200 : 'OK';
        }
        if (item.op === 'response-body') {
          responseSelf(self);
          if (item.kind === 'text') return port.resolve('');
          if (item.kind === 'json') return port.resolve({});
          const ctor = callable(port, ARRAY_BUFFER);
          if (!ctor) throw new TypeError('ArrayBuffer source unavailable');
          const buffer = Reflect.construct(ctor, [0]);
          return port.resolve().then(() => buffer);
        }
        if (item.via === 'xhr') instance(port, self, XHR);
        if (item.via === 'beacon') instance(port, self, NAV);
        if (item.mode === 'capture') {
          posts.push(post(item.via, requestBody(item.via, args)));
          if (item.via === 'fetch') return resolvedResponse();
          return item.via === 'beacon' ? true : undefined;
        }
        const path = item.via === 'xhr' ? XHR_SEND : item.via === 'beacon' ? BEACON : FETCH;
        const source = callable(port, path);
        if (source) return Reflect.apply(source, self, args);
        if (item.via === 'fetch') return resolvedResponse();
        return item.via === 'beacon' ? false : undefined;
      },
      construct: (raw) => {
        if (config(raw).op !== 'response-ctor') throw port.error('TypeError', 'Illegal constructor');
        return response();
      },
      report: () => ({
        body: posts.find((entry) => entry.len > 0)?.body ?? null,
        posts: posts.map((entry) => ({ ...entry })),
      }),
      close: () => {
        posts.length = 0;
        responses = new WeakSet();
      },
    };
  },
};
