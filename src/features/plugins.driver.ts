import type { JsonValue } from '../core/types.js';
import type { Driver } from '../engine/types.js';

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError('plugins Driver config invalid');
  return value;
}

/** Chrome PluginArray/MimeTypeArray methods are non-writable; BMS MU tests overwrite. */
function lockArrayMethods(array: object): void {
  const proto = Object.getPrototypeOf(array) as object | null;
  if (proto === null) return;
  for (const key of ['item', 'namedItem', 'refresh'] as const) {
    const desc = Object.getOwnPropertyDescriptor(proto, key);
    if (!desc || !('value' in desc) || desc.writable !== true) continue;
    Object.defineProperty(proto, key, {
      value: desc.value,
      writable: false,
      enumerable: desc.enumerable === true,
      configurable: desc.configurable !== false,
    });
  }
  // Drop own overrides so prototype non-writable wins (sloppy assign must not stick).
  for (const key of ['item', 'namedItem', 'refresh'] as const) {
    if (Object.prototype.hasOwnProperty.call(array, key)) {
      try {
        Reflect.deleteProperty(array, key);
      } catch {
        /* ignore */
      }
    }
  }
}

export const pluginsDriver: Driver = {
  open: (port) => {
    const locked = new WeakSet<object>();
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'node') {
          const node = port.node(String(item.id));
          if (node !== null && (typeof node === 'object' || typeof node === 'function') && !locked.has(node as object)) {
            lockArrayMethods(node as object);
            locked.add(node as object);
          }
          return node;
        }
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
