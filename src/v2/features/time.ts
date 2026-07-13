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
const DATE_GET_TIME = 'window.Date.prototype.getTime';
const DATE_OFFSET = 'window.Date.prototype.getTimezoneOffset';
const DATE_TEXT = 'window.Date.prototype.toString';
const DATE_DATE_TEXT = 'window.Date.prototype.toDateString';
const DATE_TIME_TEXT = 'window.Date.prototype.toTimeString';
const DATE_LOCALE = 'window.Date.prototype.toLocaleString';
const DATE_LOCALE_DATE = 'window.Date.prototype.toLocaleDateString';
const DATE_LOCALE_TIME = 'window.Date.prototype.toLocaleTimeString';
const DATE_UTC_DAY = 'window.Date.prototype.getUTCDay';
const DATE_UTC_MILLISECONDS = 'window.Date.prototype.getUTCMilliseconds';
const DATE_SET_TIME = 'window.Date.prototype.setTime';
const RANDOM = 'window.Math.random';
const FORMAT = 'window.Intl.DateTimeFormat';
const FORMAT_PARTS = 'window.Intl.DateTimeFormat.prototype.formatToParts';
const FORMAT_LOCALES = 'window.Intl.DateTimeFormat.supportedLocalesOf';

const DATE_ZONE_METHODS = [
  { key: 'getTimezoneOffset', id: 'time.date.offset', slot: 'time.date.offset', mode: 'offset', path: DATE_OFFSET, length: 0 },
  { key: 'getFullYear', id: 'time.date.full-year', slot: 'time.date.full-year', mode: 'full-year', path: 'window.Date.prototype.getFullYear', length: 0 },
  { key: 'getYear', id: 'time.date.year', slot: 'time.date.year', mode: 'year', path: 'window.Date.prototype.getYear', length: 0 },
  { key: 'getMonth', id: 'time.date.month', slot: 'time.date.month', mode: 'month', path: 'window.Date.prototype.getMonth', length: 0 },
  { key: 'getDate', id: 'time.date.date', slot: 'time.date.date', mode: 'date-number', path: 'window.Date.prototype.getDate', length: 0 },
  { key: 'getDay', id: 'time.date.day', slot: 'time.date.day', mode: 'day', path: 'window.Date.prototype.getDay', length: 0 },
  { key: 'getHours', id: 'time.date.hours', slot: 'time.date.hours', mode: 'hours', path: 'window.Date.prototype.getHours', length: 0 },
  { key: 'getMinutes', id: 'time.date.minutes', slot: 'time.date.minutes', mode: 'minutes', path: 'window.Date.prototype.getMinutes', length: 0 },
  { key: 'getSeconds', id: 'time.date.seconds', slot: 'time.date.seconds', mode: 'seconds', path: 'window.Date.prototype.getSeconds', length: 0 },
  { key: 'getMilliseconds', id: 'time.date.milliseconds', slot: 'time.date.milliseconds', mode: 'milliseconds', path: 'window.Date.prototype.getMilliseconds', length: 0 },
  { key: 'setFullYear', id: 'time.date.set-full-year', slot: 'time.date.set-full-year', mode: 'set-full-year', path: 'window.Date.prototype.setFullYear', length: 3 },
  { key: 'setMonth', id: 'time.date.set-month', slot: 'time.date.set-month', mode: 'set-month', path: 'window.Date.prototype.setMonth', length: 2 },
  { key: 'setDate', id: 'time.date.set-date', slot: 'time.date.set-date', mode: 'set-date', path: 'window.Date.prototype.setDate', length: 1 },
  { key: 'setHours', id: 'time.date.set-hours', slot: 'time.date.set-hours', mode: 'set-hours', path: 'window.Date.prototype.setHours', length: 4 },
  { key: 'setMinutes', id: 'time.date.set-minutes', slot: 'time.date.set-minutes', mode: 'set-minutes', path: 'window.Date.prototype.setMinutes', length: 3 },
  { key: 'setSeconds', id: 'time.date.set-seconds', slot: 'time.date.set-seconds', mode: 'set-seconds', path: 'window.Date.prototype.setSeconds', length: 2 },
  { key: 'setMilliseconds', id: 'time.date.set-milliseconds', slot: 'time.date.set-milliseconds', mode: 'set-milliseconds', path: 'window.Date.prototype.setMilliseconds', length: 1 },
  { key: 'setYear', id: 'time.date.set-year', slot: 'time.date.set-year', mode: 'set-year', path: 'window.Date.prototype.setYear', length: 1 },
  { key: 'toString', id: 'time.date.text', slot: 'time.date.text', mode: 'text', path: DATE_TEXT, length: 0 },
  { key: 'toDateString', id: 'time.date.date-text', slot: 'time.date.date-text', mode: 'date', path: DATE_DATE_TEXT, length: 0 },
  { key: 'toTimeString', id: 'time.date.time-text', slot: 'time.date.time-text', mode: 'time', path: DATE_TIME_TEXT, length: 0 },
  { key: 'toLocaleString', id: 'time.date.locale', slot: 'time.date.locale', mode: 'locale', path: DATE_LOCALE, length: 0 },
  { key: 'toLocaleDateString', id: 'time.date.locale-date', slot: 'time.date.locale-date', mode: 'locale', path: DATE_LOCALE_DATE, length: 0 },
  { key: 'toLocaleTimeString', id: 'time.date.locale-time', slot: 'time.date.locale-time', mode: 'locale', path: DATE_LOCALE_TIME, length: 0 },
] as const;

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
    ...DATE_ZONE_METHODS.map<DraftOp>(({ key, id, slot, length }) => ({
      op: 'alloc', id, kind: 'function', slot, shape: fnShape(key, length ?? 0),
    })),
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
    ...DATE_ZONE_METHODS.map<DraftOp>(({ key, id }) => refProp(proto, key, id)),
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
    const timeZone = profile.timezone?.timeZone ?? null;
    return {
      binds: [
        {
          slot: 'time.date', driver: 'time', config: { op: 'date', now, timeZone },
          sources: [DATE, DATE_NOW, DATE_UTC, DATE_GET_TIME, DATE_TEXT, FORMAT, FORMAT_PARTS],
        },
        {
          slot: 'time.date.now', driver: 'time', config: { op: 'now', now },
          sources: [DATE_NOW],
        },
        {
          slot: 'time.date.parse', driver: 'time', config: { op: 'parse', path: DATE_PARSE, timeZone },
          sources: [DATE_PARSE, DATE_UTC, FORMAT, FORMAT_PARTS],
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
          slot: 'time.format', driver: 'time', config: { op: 'format', timeZone },
          sources: [FORMAT],
        },
        {
          slot: 'time.format.locales', driver: 'time', config: { op: 'apply', path: FORMAT_LOCALES },
          sources: [FORMAT_LOCALES],
        },
        ...DATE_ZONE_METHODS.map(({ slot, mode, path }) => ({
          slot,
          driver: 'time',
          config: mode === 'locale'
            ? { op: 'locale', path, timeZone }
            : { op: 'timezone', method: mode, path, timeZone },
          sources: mode === 'locale'
            ? [path]
            : [path, DATE, DATE_GET_TIME, DATE_SET_TIME, DATE_UTC, DATE_UTC_DAY, DATE_UTC_MILLISECONDS, FORMAT, FORMAT_PARTS],
        })),
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

function partsOf(
  port: Port,
  timeZone: string,
  value: number,
  options: Readonly<Record<string, string | boolean>>,
): Record<string, string> {
  const formatter = Reflect.construct(source(port, FORMAT), [
    'en-US-u-hc-h23',
    { timeZone, hourCycle: 'h23', ...options },
  ]);
  const raw = Reflect.apply(source(port, FORMAT_PARTS), formatter, [value]) as unknown;
  if (!Array.isArray(raw)) throw new TypeError('time formatToParts result invalid');
  const output: Record<string, string> = {};
  for (const part of raw) {
    if (part !== null && typeof part === 'object') {
      const item = part as { type?: unknown; value?: unknown };
      if (typeof item.type === 'string' && typeof item.value === 'string') output[item.type] = item.value;
    }
  }
  return output;
}

function dateValue(port: Port, self: unknown): number {
  const value = Reflect.apply(source(port, DATE_GET_TIME), self, []);
  if (typeof value !== 'number') throw new TypeError('time Date value invalid');
  return value;
}

function offset(port: Port, timeZone: string, value: number): number {
  const parts = partsOf(port, timeZone, value, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const numbers = ['year', 'month', 'day', 'hour', 'minute', 'second'].map((name) => Number(parts[name]));
  if (numbers.some((item) => !Number.isInteger(item))) throw new TypeError('time timezone parts invalid');
  const wall = Reflect.apply(source(port, DATE_UTC), undefined, [
    numbers[0], numbers[1]! - 1, numbers[2], numbers[3], numbers[4], numbers[5],
  ]);
  if (typeof wall !== 'number' || !Number.isFinite(wall)) throw new TypeError('time timezone offset invalid');
  return Math.round((Math.trunc(value / 1000) * 1000 - wall) / 60_000);
}

function dateParts(port: Port, timeZone: string, value: number): Record<string, string> {
  return partsOf(port, timeZone, value, {
    weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'long',
  });
}

function localParts(port: Port, timeZone: string, value: number): Record<string, string> {
  return partsOf(port, timeZone, value, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
}

interface LocalDate {
  year: number;
  month: number;
  date: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

function localDate(port: Port, timeZone: string, value: number): LocalDate {
  const parts = localParts(port, timeZone, value);
  const date = Reflect.construct(source(port, DATE), [value]);
  const milliseconds = Reflect.apply(source(port, DATE_UTC_MILLISECONDS), date, []);
  const local = {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    date: Number(parts.day),
    hours: Number(parts.hour),
    minutes: Number(parts.minute),
    seconds: Number(parts.second),
    milliseconds: typeof milliseconds === 'number' ? milliseconds : NaN,
  };
  if (!Object.values(local).every(Number.isInteger)) throw new TypeError('time local date parts invalid');
  return local;
}

function exactUtc(port: Port, local: LocalDate): number {
  const shifted = local.year >= 0 && local.year <= 99;
  const year = shifted ? local.year + 400 : local.year;
  const value = Reflect.apply(source(port, DATE_UTC), undefined, [
    year, local.month, local.date, local.hours, local.minutes, local.seconds, local.milliseconds,
  ]);
  if (typeof value !== 'number') throw new TypeError('time UTC conversion invalid');
  return shifted ? value - 146_097 * 86_400_000 : value;
}

function dateNumber(value: unknown): number {
  return +(value as number);
}

function wallEpoch(port: Port, timeZone: string, local: LocalDate): number {
  const wall = exactUtc(port, local);
  if (!Number.isFinite(wall)) return NaN;
  let value = wall;
  for (let attempt = 0; attempt < 3; attempt++) {
    const adjusted = wall + offset(port, timeZone, value) * 60_000;
    if (adjusted === value) break;
    value = adjusted;
  }
  return value;
}

function constructorEpoch(port: Port, timeZone: string, args: readonly unknown[]): number {
  let year = dateNumber(args[0]);
  if (Number.isFinite(year) && year >= 0 && year <= 99) year += 1900;
  return wallEpoch(port, timeZone, {
    year,
    month: dateNumber(args[1]),
    date: args.length > 2 ? dateNumber(args[2]) : 1,
    hours: args.length > 3 ? dateNumber(args[3]) : 0,
    minutes: args.length > 4 ? dateNumber(args[4]) : 0,
    seconds: args.length > 5 ? dateNumber(args[5]) : 0,
    milliseconds: args.length > 6 ? dateNumber(args[6]) : 0,
  });
}

function localIsoEpoch(port: Port, timeZone: string, value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^(\d{4,6})-(\d{2})-(\d{2})T(\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/);
  if (!match) return undefined;
  const local: LocalDate = {
    year: Number(match[1]),
    month: Number(match[2]) - 1,
    date: Number(match[3]),
    hours: Number(match[4]),
    minutes: Number(match[5] ?? 0),
    seconds: Number(match[6] ?? 0),
    milliseconds: Number((match[7] ?? '').padEnd(3, '0') || 0),
  };
  if (local.month < 0 || local.month > 11 || local.date < 1 || local.date > 31
    || local.hours < 0 || local.hours > 23 || local.minutes < 0 || local.minutes > 59
    || local.seconds < 0 || local.seconds > 59) return NaN;
  return wallEpoch(port, timeZone, local);
}

function setLocal(
  port: Port,
  self: unknown,
  timeZone: string,
  method: string,
  path: string,
  args: readonly unknown[],
): number {
  const value = dateValue(port, self);
  if (!Number.isFinite(value) && method !== 'set-full-year' && method !== 'set-year') {
    return Reflect.apply(source(port, path), self, [...args]) as number;
  }
  const local = Number.isFinite(value)
    ? localDate(port, timeZone, value)
    : { year: 1970, month: 0, date: 1, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };
  const number = (index: number): number => dateNumber(args[index]);
  if (method === 'set-full-year') {
    local.year = number(0);
    if (args.length > 1) local.month = number(1);
    if (args.length > 2) local.date = number(2);
  } else if (method === 'set-month') {
    local.month = number(0);
    if (args.length > 1) local.date = number(1);
  } else if (method === 'set-date') {
    local.date = number(0);
  } else if (method === 'set-hours') {
    local.hours = number(0);
    if (args.length > 1) local.minutes = number(1);
    if (args.length > 2) local.seconds = number(2);
    if (args.length > 3) local.milliseconds = number(3);
  } else if (method === 'set-minutes') {
    local.minutes = number(0);
    if (args.length > 1) local.seconds = number(1);
    if (args.length > 2) local.milliseconds = number(2);
  } else if (method === 'set-seconds') {
    local.seconds = number(0);
    if (args.length > 1) local.milliseconds = number(1);
  } else if (method === 'set-milliseconds') {
    local.milliseconds = number(0);
  } else if (method === 'set-year') {
    local.year = number(0);
    if (Number.isFinite(local.year) && local.year >= 0 && local.year <= 99) local.year += 1900;
  } else {
    throw new TypeError(`time setter method invalid:${method}`);
  }
  return Reflect.apply(source(port, DATE_SET_TIME), self, [wallEpoch(port, timeZone, local)]) as number;
}

function localField(port: Port, timeZone: string, value: number, method: JsonValue | undefined): number {
  if (method === 'milliseconds') {
    const date = Reflect.construct(source(port, DATE), [value]);
    const milliseconds = Reflect.apply(source(port, DATE_UTC_MILLISECONDS), date, []);
    if (typeof milliseconds !== 'number') throw new TypeError('time milliseconds invalid');
    return milliseconds;
  }
  const local = localDate(port, timeZone, value);
  if (method === 'full-year') return local.year;
  if (method === 'year') return local.year - 1900;
  if (method === 'month') return local.month;
  if (method === 'date-number') return local.date;
  if (method === 'hours') return local.hours;
  if (method === 'minutes') return local.minutes;
  if (method === 'seconds') return local.seconds;
  if (method === 'day') {
    const midnight = exactUtc(port, { ...local, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 });
    const date = Reflect.construct(source(port, DATE), [midnight]);
    const weekday = Reflect.apply(source(port, DATE_UTC_DAY), date, []);
    if (typeof weekday !== 'number') throw new TypeError('time weekday invalid');
    return weekday;
  }
  throw new TypeError(`time local method invalid:${String(method)}`);
}

function dateText(port: Port, timeZone: string, value: number): string {
  const parts = dateParts(port, timeZone, value);
  return `${parts.weekday} ${parts.month} ${parts.day} ${parts.year}`;
}

function timeText(port: Port, timeZone: string, value: number): string {
  const parts = dateParts(port, timeZone, value);
  const minutes = offset(port, timeZone, value);
  const absolute = Math.abs(minutes);
  const gmt = `GMT${minutes <= 0 ? '+' : '-'}${String(Math.trunc(absolute / 60)).padStart(2, '0')}${String(absolute % 60).padStart(2, '0')}`;
  return `${parts.hour}:${parts.minute}:${parts.second} ${gmt} (${parts.timeZoneName || timeZone})`;
}

function zonedDateCall(port: Port, timeZone: string, value: number): string {
  return `${dateText(port, timeZone, value)} ${timeText(port, timeZone, value)}`;
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
          const timeZone = nullableString(item.timeZone, 'timeZone');
          if (now === null && timeZone === null) return Reflect.apply(date, self, [...args]);
          const value = now ?? Reflect.apply(source(port, DATE_NOW), undefined, []);
          if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('time now invalid');
          if (timeZone !== null) return zonedDateCall(port, timeZone, value);
          const dateObject = Reflect.construct(date, [now]);
          return Reflect.apply(source(port, DATE_TEXT), dateObject, []);
        }
        if (item.op === 'now') {
          const now = nullableNumber(item.now, 'now');
          return now ?? Reflect.apply(source(port, DATE_NOW), self, []);
        }
        if (item.op === 'apply' && typeof item.path === 'string') {
          return Reflect.apply(source(port, item.path), self, [...args]);
        }
        if (item.op === 'parse' && typeof item.path === 'string') {
          const timeZone = nullableString(item.timeZone, 'timeZone');
          const parsed = timeZone === null ? undefined : localIsoEpoch(port, timeZone, args[0]);
          return parsed ?? Reflect.apply(source(port, item.path), self, [...args]);
        }
        if (item.op === 'random') {
          const seed = nullableNumber(item.seed, 'seed');
          if (seed === null) return Reflect.apply(source(port, RANDOM), self, []);
          // Realm zero preserves the public seed sequence; child ordinals split deterministic streams.
          const realm = port.realm();
          randomState ??= realm === 0 ? seed >>> 0 : (seed ^ Math.imul(realm, 0x9e37_79b1)) >>> 0;
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
        if (item.op === 'timezone') {
          const timeZone = nullableString(item.timeZone, 'timeZone');
          if (timeZone === null && typeof item.path === 'string') {
            return Reflect.apply(source(port, item.path), self, [...args]);
          }
          if (timeZone === null) throw new TypeError('time timezone missing');
          const value = dateValue(port, self);
          if (item.method === 'offset') return Number.isFinite(value) ? offset(port, timeZone, value) : NaN;
          if (typeof item.method === 'string' && [
            'full-year', 'year', 'month', 'date-number', 'day', 'hours', 'minutes', 'seconds', 'milliseconds',
          ].includes(item.method)) return Number.isFinite(value) ? localField(port, timeZone, value, item.method) : NaN;
          if (typeof item.method === 'string' && item.method.startsWith('set-') && typeof item.path === 'string') {
            return setLocal(port, self, timeZone, item.method, item.path, args);
          }
          if (!Number.isFinite(value)) return 'Invalid Date';
          if (item.method === 'text') return zonedDateCall(port, timeZone, value);
          if (item.method === 'date') return dateText(port, timeZone, value);
          if (item.method === 'time') return timeText(port, timeZone, value);
          throw new TypeError(`time timezone method invalid:${String(item.method)}`);
        }
        if (item.op === 'locale' && typeof item.path === 'string') {
          const timeZone = nullableString(item.timeZone, 'timeZone');
          return Reflect.apply(source(port, item.path), self, formatArgs(args, timeZone));
        }
        throw new TypeError(`time Driver op invalid:${String(item.op)}`);
      },
      construct: (raw, args, newTarget) => {
        const item = config(raw);
        if (item.op === 'date') {
          const now = nullableNumber(item.now, 'now');
          const timeZone = nullableString(item.timeZone, 'timeZone');
          let values: readonly unknown[] = args.length === 0 && now !== null ? [now] : [...args];
          if (timeZone !== null && args.length >= 2) values = [constructorEpoch(port, timeZone, args)];
          if (timeZone !== null && args.length === 1) {
            const parsed = localIsoEpoch(port, timeZone, args[0]);
            if (parsed !== undefined) values = [parsed];
          }
          return Reflect.construct(source(port, DATE), values, newTarget);
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
