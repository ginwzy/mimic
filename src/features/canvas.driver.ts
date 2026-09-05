import type { JsonValue } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import type { METRIC_FIELDS } from './canvas.shared.js';
import { HTML_CANVAS, CLAMPED } from './canvas.shared.js';

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || typeof value.op !== 'string') {
    throw new TypeError('canvas Driver config invalid');
  }
  return value;
}

function object(port: Port, value: unknown): object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw port.error('TypeError', 'Illegal invocation');
  }
  return value;
}

function made(port: Port, proto: JsonValue | undefined): object {
  const value = port.make(String(proto));
  return object(port, value);
}

function positive(value: unknown, port: Port): number {
  const number = Number(value);
  const integer = Math.trunc(number);
  if (!Number.isFinite(number) || integer <= 0) throw port.error('RangeError', 'The source width is 0.');
  return integer;
}

interface ImageState {
  data: unknown;
  width: number;
  height: number;
  colorSpace: string;
}

type MetricState = Record<(typeof METRIC_FIELDS)[number], number>;

export const canvasDriver: Driver = {
  open: (port) => {
    const contexts = new WeakMap<object, object>();
    const families = new WeakMap<object, Function>();
    const owners = new WeakMap<object, object>();
    const styles = new WeakMap<object, Map<string, unknown>>();
    const images = new WeakMap<object, ImageState>();
    const metrics = new WeakMap<object, MetricState>();
    const gradients = new WeakSet<object>();
    const paths = new WeakSet<object>();
    const htmlCanvas = port.source(HTML_CANVAS);
    if (typeof htmlCanvas !== 'function') throw new TypeError('canvas HTMLCanvasElement source is not callable');

    const canvas = (value: unknown): object => {
      const target = object(port, value);
      if (!Reflect.apply(Function.prototype[Symbol.hasInstance], htmlCanvas, [target])) {
        throw port.error('TypeError', 'Illegal invocation');
      }
      return target;
    };

    const context = (value: unknown): object => {
      const target = object(port, value);
      if (!owners.has(target)) throw port.error('TypeError', 'Illegal invocation');
      return target;
    };
    const image = (proto: JsonValue | undefined, width: unknown, height: unknown): object => {
      const w = positive(width, port);
      const h = positive(height, port);
      const ctor = port.source(CLAMPED);
      if (typeof ctor !== 'function') throw new TypeError('canvas Uint8ClampedArray source is not callable');
      const target = made(port, proto);
      images.set(target, { data: Reflect.construct(ctor, [w * h * 4]), width: w, height: h, colorSpace: 'srgb' });
      return target;
    };
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'get') {
          const target = canvas(self);
          const provider = Reflect.get(object(port, port.node(String(item.registry))), String(args[0]));
          if (typeof provider !== 'function') return null;
          const family = families.get(target);
          if (family && family !== provider) return null;
          const value = Reflect.apply(provider, target, args.slice(1));
          if (value !== null && value !== undefined) families.set(target, provider);
          return value;
        }
        if (item.op === 'context') {
          const owner = canvas(self);
          let context = contexts.get(owner);
          if (!context) {
            context = made(port, item.proto);
            contexts.set(owner, context);
            owners.set(context, owner);
          }
          return context;
        }
        if (item.op === 'canvas') {
          const target = context(self);
          const canvas = owners.get(target);
          if (!canvas) throw port.error('TypeError', 'Illegal invocation');
          return canvas;
        }
        if (item.op === 'void') {
          context(self);
          return undefined;
        }
        if (item.op === 'gradient') {
          context(self);
          const target = made(port, item.proto);
          gradients.add(target);
          return target;
        }
        if (item.op === 'attributes') {
          context(self);
          return port.clone({ alpha: true, colorSpace: 'srgb', desynchronized: false, willReadFrequently: false });
        }
        if (item.op === 'matrix') {
          context(self);
          const target = made(port, item.proto);
          const values = {
            a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
            m11: 1, m12: 0, m13: 0, m14: 0, m21: 0, m22: 1, m23: 0, m24: 0,
            m31: 0, m32: 0, m33: 1, m34: 0, m41: 0, m42: 0, m43: 0, m44: 1,
            is2D: true, isIdentity: true,
          };
          for (const [name, value] of Object.entries(values)) Reflect.defineProperty(target, name, {
            value, writable: true, enumerable: true, configurable: true,
          });
          return target;
        }
        if (item.op === 'false') {
          context(self);
          return false;
        }
        if (item.op === 'dash') {
          context(self);
          return port.clone([]);
        }
        if (item.op === 'gradient-add') {
          if (!gradients.has(object(port, self))) throw port.error('TypeError', 'Illegal invocation');
          return undefined;
        }
        if (item.op === 'path-method') {
          if (!paths.has(object(port, self))) throw port.error('TypeError', 'Illegal invocation');
          return undefined;
        }
        if (item.op === 'style-get') {
          const target = context(self);
          return styles.get(target)?.get(String(item.name)) ?? item.initial;
        }
        if (item.op === 'style-set') {
          const target = context(self);
          let values = styles.get(target);
          if (!values) {
            values = new Map();
            styles.set(target, values);
          }
          values.set(String(item.name), args[0]);
          return undefined;
        }
        if (item.op === 'image-get') {
          context(self);
          return image(item.proto, args[2], args[3]);
        }
        if (item.op === 'image-create') {
          context(self);
          return image(item.proto, args[0], args[1]);
        }
        if (item.op === 'image-field') {
          const state = images.get(object(port, self));
          if (!state || !(String(item.name) in state)) throw port.error('TypeError', 'Illegal invocation');
          return state[String(item.name) as keyof ImageState];
        }
        if (item.op === 'metrics') {
          const ctx = context(self);
          const target = made(port, item.proto);
          const text = String(args[0] ?? '');
          // Derive metrics from current font size (default 10px) — zero bounding boxes
          // are a jsdom-era tell; Chrome returns non-zero ascent/descent for normal fonts.
          const font = String(styles.get(ctx)?.get('font') ?? '10px sans-serif');
          const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(font);
          const size = sizeMatch ? Number(sizeMatch[1]) : 10;
          const width = text.length * size * 0.55;
          const ascent = size * 0.8;
          const descent = size * 0.2;
          const state = {
            width,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: width,
            fontBoundingBoxAscent: ascent,
            fontBoundingBoxDescent: descent,
            actualBoundingBoxAscent: ascent,
            actualBoundingBoxDescent: descent,
            emHeightAscent: ascent,
            emHeightDescent: descent,
            hangingBaseline: ascent * 0.8,
            alphabeticBaseline: 0,
            ideographicBaseline: -descent,
          } satisfies MetricState;
          metrics.set(target, state);
          return target;
        }
        if (item.op === 'metric-field') {
          const state = metrics.get(object(port, self));
          if (!state || !(String(item.name) in state)) throw port.error('TypeError', 'Illegal invocation');
          return state[String(item.name) as keyof MetricState];
        }
        if (item.op === 'url') {
          canvas(self);
          const requested = typeof args[0] === 'string' ? args[0].toLowerCase() : 'image/png';
          const type = ['image/png', 'image/jpeg', 'image/webp'].includes(requested) ? requested : 'image/png';
          const values = item.dataURLs;
          if (item.policy !== 'legacy-identity-v1' || !values || typeof values !== 'object' || Array.isArray(values)
            || typeof values[type] !== 'string') throw new TypeError('canvas URL policy config invalid');
          return values[type];
        }
        if (item.op === 'illegal') {
          throw port.error('TypeError', `Failed to construct '${String(item.name)}': Illegal constructor`);
        }
        if (item.op === 'image-ctor' || item.op === 'path-ctor') {
          const name = item.op === 'image-ctor' ? 'ImageData' : 'Path2D';
          throw port.error('TypeError', `Failed to construct '${name}': Please use the 'new' operator, this DOM object constructor cannot be called as a function.`);
        }
        throw new TypeError(`canvas Driver op invalid:${String(item.op)}`);
      },
      construct: (raw, args) => {
        const item = config(raw);
        if (item.op === 'image-ctor') return image(item.proto, args[0], args[1]);
        if (item.op === 'path-ctor') {
          const target = made(port, item.proto);
          paths.add(target);
          return target;
        }
        if (item.op === 'illegal') {
          throw port.error('TypeError', `Failed to construct '${String(item.name)}': Illegal constructor`);
        }
        throw new TypeError(`canvas Driver construct invalid:${String(item.op)}`);
      },
    };
  },
};
