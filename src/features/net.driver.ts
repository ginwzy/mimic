import type { Data, JsonValue } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import type { CapturePost } from '../core/capture.js';
import { RESPONSE_PROTO, XHR, XHR_SEND, NAV, BEACON, FETCH, ARRAY_BUFFER, type Via, type NetConfig } from './net.shared.js';
import { liveRequests, type LiveResponse } from './net.live.js';

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

export const createNetDriver = (live = false): Driver => ({
  reduceReports: (reports, records) => {
    const posts = records.length > 0
      ? records as Post[]
      : reports.flatMap((report) => (report as Data).posts as Post[]);
    return {
      body: posts.find((entry) => entry.len > 0 && typeof entry.body === 'string')?.body ?? null,
      posts: posts.map((entry) => ({ ...entry })),
      ...(live ? { pending: reports.reduce<number>((sum, report) => sum + Number((report as Data).pending ?? 0), 0) } : {}),
    };
  },
  open: (port) => {
    const posts: Post[] = [];
    const requests = live ? liveRequests(port) : undefined;
    let responses = new WeakMap<object, LiveResponse | null>();
    const bodyStates = new WeakMap<object, { used: boolean }>();
    const response = (payload: LiveResponse | null = null): object => {
      const value = port.make(RESPONSE_PROTO);
      if (value === null || typeof value !== 'object') throw new TypeError('net Response allocation failed');
      responses.set(value, payload);
      if (payload) {
        Object.defineProperty(value, 'url', { value: payload.url, enumerable: true });
        const state = port.clone({ used: false }) as { used: boolean };
        bodyStates.set(value, state);
        const bodyUsedGetter = Reflect.apply(
          port.evaluate('(state) => function bodyUsed() { return state.used; }') as Function,
          undefined,
          [state],
        ) as () => boolean;
        Object.defineProperty(value, 'bodyUsed', { get: bodyUsedGetter, enumerable: true });
        const entries = payload.headers.trim().split('\r\n').filter(Boolean).map(line => {
          const colon = line.indexOf(':');
          return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
        });
        const headers = port.evaluate(`(() => {
          const entries = ${JSON.stringify(entries)};
          const key = name => {
            name = String(name);
            if (!/^[!#$%&'*+.^_\x60|~0-9a-z-]+$/i.test(name)) throw new TypeError('Invalid header name');
            return name.toLowerCase();
          };
          return Object.freeze({
            get(name) { const entry = entries.find(entry => entry[0] === key(name)); return entry ? entry[1] : null; },
            has(name) { return entries.some(entry => entry[0] === key(name)); },
            *entries() { for (const entry of entries) yield [...entry]; },
            *keys() { for (const entry of entries) yield entry[0]; },
            *values() { for (const entry of entries) yield entry[1]; },
            forEach(callback, receiver) { for (const [name, value] of entries) callback.call(receiver, value, name, this); },
            [Symbol.iterator]() { return this.entries(); },
            [Symbol.toStringTag]: 'Headers',
            append() { throw new TypeError('immutable'); },
            set() { throw new TypeError('immutable'); },
            delete() { throw new TypeError('immutable'); },
          });
        })()`);
        Object.defineProperty(value, 'headers', { value: headers, enumerable: true });
      }
      return value;
    };
    const responseSelf = (self: unknown): LiveResponse | null => {
      if ((typeof self !== 'object' && typeof self !== 'function') || self === null || !responses.has(self)) {
        throw port.error('TypeError', 'Illegal invocation');
      }
      return responses.get(self)!;
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
          const payload = responseSelf(self);
          if (payload) {
            if (item.field === 'ok') return payload.status >= 200 && payload.status < 300;
            return item.field === 'status' ? payload.status : payload.statusText;
          }
          if (item.field === 'ok') return true;
          return item.field === 'status' ? 200 : 'OK';
        }
        if (item.op === 'response-body') {
          const payload = responseSelf(self);
          if (payload) {
            const state = bodyStates.get(self as object)!;
            if (state.used) {
              return port.resolve().then(() => {
                throw port.error('TypeError', 'Body already consumed');
              });
            }
            state.used = true;
          }
          if (payload && item.kind !== 'arrayBuffer') {
            const text = new TextDecoder().decode(payload.body);
            if (item.kind === 'text') return port.resolve(text);
            return port.resolve().then(() => port.evaluate(`JSON.parse(${JSON.stringify(text)})`));
          }
          if (item.kind === 'text') return port.resolve('');
          if (item.kind === 'json') return port.resolve({});
          const ctor = callable(port, ARRAY_BUFFER);
          if (!ctor) throw new TypeError('ArrayBuffer source unavailable');
          const buffer = Reflect.construct(ctor, [payload?.body.byteLength ?? 0]) as ArrayBuffer;
          if (payload) new Uint8Array(buffer).set(payload.body);
          return port.resolve().then(() => buffer);
        }
        if (item.via === 'xhr') instance(port, self, XHR);
        if (item.via === 'beacon') instance(port, self, NAV);
        if (item.mode === 'capture') {
          const entry = post(item.via, requestBody(item.via, args));
          posts.push(entry);
          port.record(entry);
          if (requests) {
            if (item.via === 'xhr') return requests.send(self as XMLHttpRequest, args[0]);
            if (item.via === 'beacon') {
              void requests.fetch(args[0], { method: 'POST', body: args[1], credentials: 'include' }).catch(() => {});
              return true;
            }
            return port.resolve().then(() => requests.fetch(args[0], args[1])).then(response).catch(cause => {
              throw port.error('TypeError', cause instanceof Error ? cause.message : String(cause));
            });
          }
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
        ...(requests ? { pending: requests.pending } : {}),
      }),
      close: () => {
        posts.length = 0;
        requests?.close();
        responses = new WeakMap();
      },
    };
  },
});

export const netDriver = createNetDriver();
