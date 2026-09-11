import { describeCoverage } from './capabilities.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { fnShape, refProp } from './ops.js';
import {
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

const DATE_PARSE = 'window.Date.parse';
const DATE_OFFSET = 'window.Date.prototype.getTimezoneOffset';
const DATE_DATE_TEXT = 'window.Date.prototype.toDateString';
const DATE_TIME_TEXT = 'window.Date.prototype.toTimeString';
const DATE_LOCALE = 'window.Date.prototype.toLocaleString';
const DATE_LOCALE_DATE = 'window.Date.prototype.toLocaleDateString';
const DATE_LOCALE_TIME = 'window.Date.prototype.toLocaleTimeString';
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

export function operations(): DraftOp[] {
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

export const timeFeature: Feature = {
  id: 'time',
  jobKeys: [],
  describe: (_context, support) => describeCoverage(support, {
    'time.api': 'partial',
    'time.clock': 'partial',
    'time.random': 'partial',
    'time.timezone': 'partial',
  }),
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
