import type { JsonValue } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import { INT32, FLOAT32 } from './webgl.shared.js';

const TYPED: Readonly<Record<string, string>> = {
  '3386': INT32,
  '33901': FLOAT32,
  '33902': FLOAT32,
};

const ATTRS = {
  alpha: true,
  antialias: true,
  depth: true,
  desynchronized: false,
  failIfMajorPerformanceCaveat: false,
  powerPreference: 'default',
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  stencil: false,
  xrCompatible: false,
} as const;

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || typeof value.op !== 'string') {
    throw new TypeError('webgl Driver config invalid');
  }
  return value;
}

function object(port: Port, value: unknown): object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw port.error('TypeError', 'Illegal invocation');
  }
  return value;
}

export const webglDriver: Driver = {
  open: (port) => {
    const caches = new Map<string, WeakMap<object, object>>();
    const owners = new WeakMap<object, object>();
    let debug: object | undefined;
    const precisions = new WeakMap<object, { rangeMin: number; rangeMax: number; precision: number }>();
    const int32 = port.source(INT32);
    const float32 = port.source(FLOAT32);
    if (typeof int32 !== 'function' || typeof float32 !== 'function') {
      throw new TypeError('webgl typed array source is not callable');
    }
    const context = (value: unknown): object => {
      const target = object(port, value);
      if (!owners.has(target)) throw port.error('TypeError', 'Illegal invocation');
      return target;
    };
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'context') {
          if (item.enabled !== true) return null;
          const owner = object(port, self);
          const type = String(item.type);
          let cache = caches.get(type);
          if (!cache) {
            cache = new WeakMap();
            caches.set(type, cache);
          }
          let context = cache.get(owner);
          if (!context) {
            context = object(port, port.make(String(item.proto)));
            cache.set(owner, context);
            owners.set(context, owner);
          }
          return context;
        }
        if (item.op === 'canvas') {
          const owner = owners.get(context(self));
          if (!owner) throw port.error('TypeError', 'Illegal invocation');
          return owner;
        }
        if (item.op === 'dimension') {
          const owner = owners.get(context(self));
          if (!owner) throw port.error('TypeError', 'Illegal invocation');
          return Number(Reflect.get(owner, String(item.name))) || 0;
        }
        if (item.op === 'parameter') {
          context(self);
          const parameters = item.parameters;
          if (parameters === null || Array.isArray(parameters) || typeof parameters !== 'object') {
            throw new TypeError('webgl parameter config invalid');
          }
          const key = String(args[0]);
          const special = key === '37445' ? item.unmaskedVendor : key === '37446' ? item.unmaskedRenderer : undefined;
          const value = special === undefined ? parameters[key] : special;
          if (value === undefined) return null;
          if (!Array.isArray(value)) return value;
          const ctor = TYPED[key] === INT32 ? int32 : float32;
          return Reflect.construct(ctor, [value]);
        }
        if (item.op === 'extensions') {
          context(self);
          if (!Array.isArray(item.values) || item.values.some((value) => typeof value !== 'string')) {
            throw new TypeError('webgl extensions config invalid');
          }
          return port.clone(item.values);
        }
        if (item.op === 'extension') {
          context(self);
          if (item.enabled !== true || args[0] !== 'WEBGL_debug_renderer_info') return null;
          debug ??= object(port, port.make(String(item.proto)));
          return debug;
        }
        if (item.op === 'attributes') {
          context(self);
          return port.clone(ATTRS);
        }
        if (item.op === 'precision') {
          context(self);
          const values = item.values;
          if (values === null || Array.isArray(values) || typeof values !== 'object') {
            throw new TypeError('webgl precision config invalid');
          }
          const value = values[`${String(args[0])}-${String(args[1])}`];
          if (value === null || Array.isArray(value) || typeof value !== 'object') return null;
          const rangeMin = value.rangeMin;
          const rangeMax = value.rangeMax;
          const precisionValue = value.precision;
          if (typeof rangeMin !== 'number' || typeof rangeMax !== 'number' || typeof precisionValue !== 'number') {
            throw new TypeError('webgl precision entry invalid');
          }
          const target = object(port, port.make(String(item.proto)));
          precisions.set(target, { rangeMin, rangeMax, precision: precisionValue });
          return target;
        }
        if (item.op === 'precision-field') {
          const value = precisions.get(object(port, self));
          const name = String(item.name) as 'rangeMin' | 'rangeMax' | 'precision';
          if (!value || !(name in value)) throw port.error('TypeError', 'Illegal invocation');
          return value[name];
        }
        if (item.op === 'illegal') {
          throw port.error('TypeError', `Failed to construct '${String(item.name)}': Illegal constructor`);
        }
        throw new TypeError(`webgl Driver op invalid:${String(item.op)}`);
      },
      construct: (raw) => {
        const item = config(raw);
        if (item.op === 'illegal') {
          throw port.error('TypeError', `Failed to construct '${String(item.name)}': Illegal constructor`);
        }
        throw new TypeError(`webgl Driver construct invalid:${String(item.op)}`);
      },
    };
  },
};
