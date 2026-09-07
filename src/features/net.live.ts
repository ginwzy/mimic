import type { Port } from '../engine/types.js';
import { jsdomImplementation, observeJsdomEvent } from '../engine/jsdom-compat.js';
import { XHR, XHR_SEND } from './net.shared.js';
import { networkUrl } from '../network/types.js';

export interface LiveResponse {
  status: number;
  statusText: string;
  url: string;
  body: Uint8Array;
  headers: string;
}

/** Native jsdom XHR owns response events, CORS and cookies; only transport is replaced. */
export function liveRequests(port: Port) {
  const pending = new Set<XMLHttpRequest>();
  const send = (xhr: XMLHttpRequest, body: unknown) => {
    const impl = jsdomImplementation(xhr, 'XMLHttpRequest');
    if (impl._synchronous === true) {
      throw port.error('TypeError', 'Closed-loop capture does not support synchronous XMLHttpRequest');
    }
    if (impl._url) {
      try { networkUrl(String(impl._url)); } catch {
        throw port.error('TypeError', 'Closed-loop XMLHttpRequest requires HTTP(S) URLs without credentials');
      }
    }
    if (pending.has(xhr)) throw port.error('TypeError', 'XMLHttpRequest is already sending');
    let unobserve = () => {};
    const completed = () => {
      pending.delete(xhr);
      unobserve();
    };
    pending.add(xhr);
    unobserve = observeJsdomEvent(xhr, 'loadend', completed);
    try {
      Reflect.apply(port.source(XHR_SEND) as Function, xhr, [body]);
    } catch (cause) {
      completed();
      throw cause;
    }
  };
  const fetch = (url: unknown, init: unknown = {}): Promise<LiveResponse> => {
    return new Promise((resolve, reject) => {
      const options = (init ?? {}) as RequestInit;
      if (url !== null && typeof url === 'object' && 'url' in url) {
        throw port.error('TypeError', 'Closed-loop fetch requires a URL, not a Request object');
      }
      if (options.body && typeof options.body === 'object' && 'getReader' in options.body) {
        throw port.error('TypeError', 'Closed-loop fetch does not support streaming request bodies');
      }
      const xhr = Reflect.construct(port.source(XHR) as Function, []) as XMLHttpRequest;
      const target = String(url);
      xhr.open(options.method ?? 'GET', target, true);
      xhr.responseType = 'arraybuffer';
      if (options.credentials === 'omit') {
        throw port.error('TypeError', 'Closed-loop fetch does not support credentials=omit');
      }
      if (options.mode === 'no-cors' || (options.redirect && options.redirect !== 'follow')) {
        throw port.error('TypeError', 'Closed-loop fetch requires CORS responses and redirect=follow');
      }
      xhr.withCredentials = options.credentials === 'include';
      const headers = new Headers(options.headers);
      headers.forEach((value, name) => xhr.setRequestHeader(name, value));
      const signal = options.signal;
      const abort = () => xhr.abort();
      if (signal?.aborted) {
        reject(port.error('Error', 'Fetch aborted'));
        return;
      }
      const unobserveAbort = signal ? observeJsdomEvent(signal, 'abort', abort, true) : () => {};
      observeJsdomEvent(xhr, 'loadend', unobserveAbort, true);
      observeJsdomEvent(xhr, 'load', () => resolve({
        status: xhr.status, statusText: xhr.statusText, url: xhr.responseURL,
        body: new Uint8Array(xhr.response as ArrayBuffer), headers: xhr.getAllResponseHeaders(),
      }), true);
      for (const type of ['error', 'abort', 'timeout']) {
        observeJsdomEvent(xhr, type, () => reject(port.error('TypeError', `Fetch ${type}`)), true);
      }
      try { send(xhr, options.body ?? null); } catch (cause) {
        unobserveAbort();
        reject(cause);
      }
    });
  };
  return {
    send,
    fetch,
    get pending() { return pending.size; },
    close() {
      for (const xhr of [...pending]) xhr.abort();
      pending.clear();
    },
  };
}
