import type { JsonValue } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import {
  CANONICAL_LOCALES,
  DATE_TEXT,
  DATE,
  DATE_NOW,
  DATE_UTC,
  DATE_GET_TIME,
  FORMAT,
  FORMAT_PARTS,
  RANDOM,
  DATE_SET_TIME,
  DATE_UTC_DAY,
  DATE_UTC_MILLISECONDS,
} from './time.shared.js';

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

function localeArgs(port: Port, args: readonly unknown[], locale: string | null, index = 0): unknown[] {
  const output = [...args];
  if (locale === null) return output;
  const locales = Reflect.apply(source(port, CANONICAL_LOCALES), undefined, [args[index]]) as string[];
  // Native locale negotiation must fall back to the Profile, not the host locale.
  output[index] = [...locales, locale];
  return output;
}

function formatArgs(port: Port, args: readonly unknown[], timeZone: string | null, locale: string | null): unknown[] {
  const output = localeArgs(port, args, locale);
  if (timeZone === null || args[1] === null) return output;
  const target = args[1] === undefined ? Object.create(null) as object : Object(args[1]);
  const options = new Proxy(target, {
    get: (value, key) => {
      const current = Reflect.get(value, key, value);
      return key === 'timeZone' && current === undefined ? timeZone : current;
    },
  });
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
        return Reflect.apply(source(port, FORMAT), self, formatArgs(port, args, timeZone, nullableString(item.locale ?? null, 'locale')));
        }
        if ((item.op === 'intl' || item.op === 'locale-method') && typeof item.path === 'string') {
          return Reflect.apply(source(port, item.path), self, localeArgs(port, args, nullableString(item.locale, 'locale'),
            item.op === 'locale-method' ? item.index as number : 0));
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
        return Reflect.apply(source(port, item.path), self, formatArgs(port, args, timeZone, nullableString(item.locale ?? null, 'locale')));
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
        return Reflect.construct(source(port, FORMAT), formatArgs(port, args, timeZone, nullableString(item.locale ?? null, 'locale')), newTarget);
        }
        if (item.op === 'intl' && typeof item.path === 'string') {
          return Reflect.construct(source(port, item.path), localeArgs(port, args, nullableString(item.locale, 'locale')), newTarget);
        }
        throw new TypeError(`time Driver construct invalid:${String(item.op)}`);
      },
    };
  },
};
