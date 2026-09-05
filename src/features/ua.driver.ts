import type { JsonValue } from '../core/types.js';
import type { Driver } from '../engine/types.js';

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError('ua Driver config invalid');
  return value;
}

function data(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError('ua data invalid');
  return value;
}

export const uaDriver: Driver = {
  open: (port) => ({
    call: (raw, _self, args) => {
      const item = config(raw);
      if (item.op === 'node') return port.node(String(item.id));
      if (item.op === 'value') return item.value !== null && typeof item.value === 'object' ? port.clone(item.value) : item.value;
      const ua = data(item.data);
      const brands = ua.brands ?? null;
      const mobile = ua.mobile ?? null;
      const platform = ua.platform ?? null;
      if (item.op === 'json') return port.clone({ brands, mobile, platform });
      if (item.op === 'high') {
        const output: Record<string, JsonValue> = { brands, mobile, platform };
        const hints = Array.isArray(args[0]) ? args[0] : [];
        for (const hint of hints) if (typeof hint === 'string' && hint in ua && !['brands', 'mobile', 'platform'].includes(hint)) output[hint] = ua[hint]!;
        return port.resolve(output);
      }
      throw new TypeError(`ua Driver op invalid:${String(item.op)}`);
    },
    construct: (raw) => {
      if (config(raw).op === 'illegal') throw port.error('TypeError', 'Illegal constructor');
      return undefined;
    },
  }),
};
