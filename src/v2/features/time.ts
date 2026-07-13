import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Shape } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { fnShape, refProp } from './ops.js';

const DATE = 'window.Date';
const DATE_NOW = 'window.Date.now';
const DATE_PARSE = 'window.Date.parse';
const DATE_UTC = 'window.Date.UTC';
const DATE_TEXT = 'window.Date.prototype.toString';
const RANDOM = 'window.Math.random';
const FORMAT = 'window.Intl.DateTimeFormat';
const FORMAT_LOCALES = 'window.Intl.DateTimeFormat.supportedLocalesOf';

function operations(): DraftOp[] {
  const date = { node: 'time.date' } as const;
  const proto = { path: 'window.Date.prototype' } as const;
  const format = { node: 'time.format' } as const;
  const formatProto = { path: 'window.Intl.DateTimeFormat.prototype' } as const;
  return [
    {
      op: 'alloc', id: 'time.date', kind: 'function', slot: 'time.date', prototype: proto,
      shape: fnShape('Date', 7, true, true),
    },
    { op: 'alloc', id: 'time.date.now', kind: 'function', slot: 'time.date.now', shape: fnShape('now') },
    { op: 'alloc', id: 'time.date.parse', kind: 'function', slot: 'time.date.parse', shape: fnShape('parse', 1) },
    { op: 'alloc', id: 'time.date.utc', kind: 'function', slot: 'time.date.utc', shape: fnShape('UTC', 7) },
    { op: 'alloc', id: 'time.random', kind: 'function', slot: 'time.random', shape: fnShape('random') },
    {
      op: 'alloc', id: 'time.format', kind: 'function', slot: 'time.format', prototype: formatProto,
      shape: fnShape('DateTimeFormat', 0, true, true),
    },
    {
      op: 'alloc', id: 'time.format.locales', kind: 'function', slot: 'time.format.locales',
      shape: fnShape('supportedLocalesOf', 1),
    },
    refProp({ path: 'window' }, 'Date', 'time.date'),
    refProp(proto, 'constructor', 'time.date'),
    refProp(date, 'now', 'time.date.now'),
    refProp(date, 'parse', 'time.date.parse'),
    refProp(date, 'UTC', 'time.date.utc'),
    refProp({ path: 'window.Math' }, 'random', 'time.random'),
    refProp({ path: 'window.Intl' }, 'DateTimeFormat', 'time.format'),
    refProp(formatProto, 'constructor', 'time.format'),
    refProp(format, 'supportedLocalesOf', 'time.format.locales'),
    { op: 'order', target: date, keys: ['length', 'name', 'prototype', 'now', 'parse', 'UTC'] },
    { op: 'order', target: format, keys: ['length', 'name', 'prototype', 'supportedLocalesOf'] },
  ];
}

export function timeShape(input: Shape): Shape {
  if (input.features.includes('time')) return input;
  const { hash: _hash, ...body } = input;
  return parseShape(seal({
    ...body,
    features: [...input.features, 'time'].sort(),
    ops: [...input.ops, ...operations()],
    support: {
      ...input.support,
      'time.shape': input.level === 'captured' ? 'captured' : 'derived',
      'time.api': 'emulated',
    },
  }));
}

export const timeFeature: Feature = {
  id: 'time',
  rev: '1',
  build: ({ profile, page }) => {
    const now = page?.clock?.now ?? null;
    return {
      binds: [
        {
          slot: 'time.date', driver: 'time', config: { op: 'date', now },
          sources: [DATE, DATE_TEXT],
        },
        {
          slot: 'time.date.now', driver: 'time', config: { op: 'now', now },
          sources: [DATE_NOW],
        },
        {
          slot: 'time.date.parse', driver: 'time', config: { op: 'apply', path: DATE_PARSE },
          sources: [DATE_PARSE],
        },
        {
          slot: 'time.date.utc', driver: 'time', config: { op: 'apply', path: DATE_UTC },
          sources: [DATE_UTC],
        },
        {
          slot: 'time.random', driver: 'time', config: { op: 'random', seed: page?.clock?.seed ?? null },
          sources: [RANDOM],
        },
        {
          slot: 'time.format', driver: 'time', config: { op: 'format', timeZone: profile.timezone?.timeZone ?? null },
          sources: [FORMAT],
        },
        {
          slot: 'time.format.locales', driver: 'time', config: { op: 'apply', path: FORMAT_LOCALES },
          sources: [FORMAT_LOCALES],
        },
      ],
      support: {
        'time.clock': page?.clock ? 'emulated' : 'unsupported',
        'time.random': page?.clock ? 'emulated' : 'unsupported',
        'time.timezone': profile.timezone ? profile.evidence.timezone.support : 'unsupported',
      },
    };
  },
};

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || typeof value.op !== 'string') {
    throw new TypeError('time Driver config invalid');
  }
  return value;
}

function source(port: Port, path: string): Function {
  const value = port.source(path);
  if (typeof value !== 'function') throw new TypeError(`time source is not callable:${path}`);
  return value;
}

function nullableNumber(value: JsonValue | undefined, name: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`time ${name} invalid`);
  return value;
}

function nullableString(value: JsonValue | undefined, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`time ${name} invalid`);
  return value;
}

function formatArgs(args: readonly unknown[], timeZone: string | null): unknown[] {
  if (timeZone === null || args[1] === null) return [...args];
  const target = args[1] === undefined ? Object.create(null) as object : Object(args[1]);
  const options = new Proxy(target, {
    get: (value, key) => {
      const current = Reflect.get(value, key, value);
      return key === 'timeZone' && current === undefined ? timeZone : current;
    },
  });
  const output = [...args];
  output[1] = options;
  return output;
}

export const timeDriver: Driver = {
  open: (port) => {
    let randomState: number | undefined;
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'date') {
          const date = source(port, DATE);
          const now = nullableNumber(item.now, 'now');
          if (now === null) return Reflect.apply(date, self, [...args]);
          const value = Reflect.construct(date, [now]);
          return Reflect.apply(source(port, DATE_TEXT), value, []);
        }
        if (item.op === 'now') {
          const now = nullableNumber(item.now, 'now');
          return now ?? Reflect.apply(source(port, DATE_NOW), self, []);
        }
        if (item.op === 'apply' && typeof item.path === 'string') {
          return Reflect.apply(source(port, item.path), self, [...args]);
        }
        if (item.op === 'random') {
          const seed = nullableNumber(item.seed, 'seed');
          if (seed === null) return Reflect.apply(source(port, RANDOM), self, []);
          // Mulberry32 gives every Runtime a small, reproducible 32-bit stream.
          randomState ??= seed >>> 0;
          randomState = (randomState + 0x6d2b79f5) >>> 0;
          let value = randomState;
          value = Math.imul(value ^ (value >>> 15), value | 1);
          value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
          return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
        }
        if (item.op === 'format') {
          const timeZone = nullableString(item.timeZone, 'timeZone');
          return Reflect.apply(source(port, FORMAT), self, formatArgs(args, timeZone));
        }
        throw new TypeError(`time Driver op invalid:${String(item.op)}`);
      },
      construct: (raw, args, newTarget) => {
        const item = config(raw);
        if (item.op === 'date') {
          const now = nullableNumber(item.now, 'now');
          return Reflect.construct(source(port, DATE), args.length === 0 && now !== null ? [now] : [...args], newTarget);
        }
        if (item.op === 'format') {
          const timeZone = nullableString(item.timeZone, 'timeZone');
          return Reflect.construct(source(port, FORMAT), formatArgs(args, timeZone), newTarget);
        }
        throw new TypeError(`time Driver construct invalid:${String(item.op)}`);
      },
    };
  },
};
