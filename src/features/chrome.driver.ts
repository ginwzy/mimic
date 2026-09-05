import type { JsonValue } from '../core/types.js';
import type { Driver } from '../engine/types.js';

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError('chrome Driver config invalid');
  return value;
}

export const chromeDriver: Driver = {
  open: (port) => {
    // Per-iframe loading attribute; Chrome defaults to "auto".
    const loading = new WeakMap<object, string>();
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'load') {
          const time = port.origin() / 1000;
          return port.clone({
            requestTime: time, startLoadTime: time, commitLoadTime: time + 0.04,
            finishDocumentLoadTime: 0, finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0,
            navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true,
            npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2',
          });
        }
        if (item.op === 'csi') {
          const time = Math.floor(port.origin());
          return port.clone({ startE: time, onloadT: time + 300, pageT: 1200.5, tran: 15 });
        }
        if (item.op === 'value') {
          return item.value !== null && typeof item.value === 'object' ? port.clone(item.value) : item.value;
        }
        if (item.op === 'permission') return port.resolve('default');
        if (item.op === 'token-false') {
          return Promise.resolve(false);
        }
        if (item.op === 'iframe-loading-get') {
          if (self !== null && typeof self === 'object') {
            return loading.get(self) ?? 'auto';
          }
          return 'auto';
        }
        if (item.op === 'iframe-loading-set') {
          if (self !== null && typeof self === 'object') {
            const next = args[0] === undefined || args[0] === null ? 'auto' : String(args[0]);
            loading.set(self, next === '' ? 'auto' : next);
          }
          return undefined;
        }
        throw new TypeError(`chrome Driver op invalid:${String(item.op)}`);
      },
    };
  },
};
