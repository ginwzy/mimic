import type { JsonValue } from '../core/types.js';
import type { Driver } from '../engine/types.js';

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError('plugins Driver config invalid');
  return value;
}

export const pluginsDriver: Driver = {
  open: (port) => {
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'node') return port.node(String(item.id));
        if (item.op === 'void') return undefined;
        if (item.op === 'length') {
          let length = 0;
          while (self !== null && (typeof self === 'object' || typeof self === 'function') && Reflect.has(self, String(length))) length++;
          return length;
        }
        if (item.op === 'item') {
          // WebIDL unsigned long → ToUint32 (e.g. -1 → 2^32-1 → out of range → null).
          if (self === null || (typeof self !== 'object' && typeof self !== 'function')) return null;
          const index = Number(args[0]);
          if (!Number.isFinite(index)) return null;
          const u = index >>> 0;
          return Reflect.get(self, String(u)) ?? null;
        }
        if (item.op === 'named') {
          if (self === null || (typeof self !== 'object' && typeof self !== 'function')) return null;
          return Reflect.get(self, String(args[0])) ?? null;
        }
        if (item.op === 'enabled') return item.id === null ? null : port.node(String(item.id));
        if (item.op === 'field') {
          const map = config(item.records);
          for (const [id, value] of Object.entries(map)) if (port.node(id) === self) return value;
          return '';
        }
        throw new TypeError(`plugins Driver op invalid:${String(item.op)}`);
      },
      construct: (raw) => {
        if (config(raw).op === 'illegal') throw port.error('TypeError', 'Illegal constructor');
        return undefined;
      },
    };
  },
};
