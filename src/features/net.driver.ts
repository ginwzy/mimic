import type { Data, JsonValue } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import type { CapturePost } from '../core/capture.js';
import { RESPONSE_PROTO, XHR, XHR_SEND, NAV, BEACON, FETCH, ARRAY_BUFFER, type Via, type NetConfig } from './net.shared.js';

interface Post extends CapturePost {
  via: Via;
}
function config(value: JsonValue | undefined): NetConfig {
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
  reduceReports: (reports, records) => {
    const posts = records.length > 0
      ? records as Post[]
      : reports.flatMap((report) => (report as Data).posts as Post[]);
    return {
      body: posts.find((entry) => entry.len > 0 && typeof entry.body === 'string')?.body ?? null,
      posts: posts.map((entry) => ({ ...entry })),
    };
  },
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
          const entry = post(item.via, requestBody(item.via, args));
          posts.push(entry);
          port.record(entry);
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
