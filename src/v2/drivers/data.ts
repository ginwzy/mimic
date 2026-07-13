import type { JsonValue } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError('data Driver config invalid');
  return value;
}

export const dataDriver: Driver = {
  open: (port: Port) => {
    const handlers = new WeakMap<object, Map<string, unknown>>();
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        switch (item.op) {
          case 'value': return item.value !== null && typeof item.value === 'object' ? port.clone(item.value) : item.value;
          case 'void': return undefined;
          case 'source': return port.source(String(item.path));
          case 'node': return port.node(String(item.id));
          case 'resolve': return port.resolve('value' in item ? item.value : undefined);
          case 'handler-get': {
            if ((typeof self !== 'object' && typeof self !== 'function') || self === null) return null;
            return handlers.get(self)?.get(String(item.name)) ?? null;
          }
          case 'handler-set': {
            if ((typeof self !== 'object' && typeof self !== 'function') || self === null) return undefined;
            let values = handlers.get(self);
            if (!values) {
              values = new Map();
              handlers.set(self, values);
            }
            values.set(String(item.name), args[0] ?? null);
            return undefined;
          }
          default: throw new TypeError(`data Driver op invalid:${String(item.op)}`);
        }
      },
      construct: (raw) => {
        const item = config(raw);
        if (item.op === 'illegal') throw port.error('TypeError', 'Illegal constructor');
        return undefined;
      },
    };
  },
};
