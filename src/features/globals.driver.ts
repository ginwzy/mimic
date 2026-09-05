import type { JsonValue } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import { systemColorLookup, wrapComputedStyle, type SystemColorsPalette } from './system-colors.js';

interface Config {
  op: string;
  source?: string;
  field?: string;
  action?: string;
  palette?: SystemColorsPalette;
}

interface MediaState {
  media: string;
  onchange: unknown;
}

function readPalette(value: JsonValue | undefined): SystemColorsPalette | undefined {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') return undefined;
  const raw = value.palette;
  if (raw === null || raw === undefined || Array.isArray(raw) || typeof raw !== 'object') return undefined;
  return raw as SystemColorsPalette;
}

function config(value: JsonValue | undefined): Config {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || typeof value.op !== 'string') {
    throw new TypeError('globals Driver config invalid');
  }
  const palette = readPalette(value);
  return {
    op: value.op,
    ...(typeof value.source === 'string' ? { source: value.source } : {}),
    ...(typeof value.field === 'string' ? { field: value.field } : {}),
    ...(typeof value.action === 'string' ? { action: value.action } : {}),
    ...(palette ? { palette } : {}),
  };
}

function liveNumber(port: Port, expression: string): number {
  try {
    const raw = port.evaluate(expression);
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function liveTouchPoints(port: Port): number {
  // Prefer live realm read. captureSources can freeze path sources at jsdom's 0
  // before nav install; expression eval can also return undefined if the getter
  // is not visible to bare identifiers — use window.navigator explicitly.
  for (const expr of [
    'window.navigator.maxTouchPoints',
    'navigator.maxTouchPoints',
    '(function(){return navigator.maxTouchPoints})()',
  ]) {
    const n = liveNumber(port, expr);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const sourced = Number(port.source('window.navigator.maxTouchPoints'));
  if (Number.isFinite(sourced) && sourced > 0) return sourced;
  return 0;
}

function mediaFeature(port: Port, feature: string): boolean {
  const [rawName, rawValue] = feature.split(':', 2);
  const name = rawName?.trim();
  const value = rawValue?.trim();
  // Live reads: captureSources freezes values before nav/view install, so
  // port.source('window.navigator.maxTouchPoints') stays at jsdom's 0 and
  // Android (pointer:coarse) wrongly reports as fine (BMS iV266).
  const width = liveNumber(port, 'window.innerWidth');
  const height = liveNumber(port, 'window.innerHeight');
  const touchPoints = liveTouchPoints(port);

  if (value === undefined) {
    if (name === 'width') return width > 0;
    if (name === 'height') return height > 0;
    if (name === 'orientation' || name === 'pointer' || name === 'any-pointer') return true;
    if (name === 'hover' || name === 'any-hover') return touchPoints === 0;
    if (name === 'color' || name === 'color-gamut') return true;
    return false;
  }

  if (name === 'orientation') return value === (width > height ? 'landscape' : 'portrait');
  if (name === 'prefers-color-scheme') return value === 'light';
  if (name === 'prefers-reduced-motion') return value === 'no-preference';
  if (name === 'hover' || name === 'any-hover') return value === (touchPoints > 0 ? 'none' : 'hover');
  if (name === 'pointer' || name === 'any-pointer') return value === (touchPoints > 0 ? 'coarse' : 'fine');
  if (name === 'color-gamut') return value === 'srgb';

  const dimension = /^(min|max)-(width|height)$/.exec(name ?? '');
  const pixels = /^(\d+(?:\.\d+)?)px$/.exec(value ?? '');
  if (dimension && pixels) {
    const actual = dimension[2] === 'width' ? width : height;
    const expected = Number(pixels[1]);
    return dimension[1] === 'min' ? actual >= expected : actual <= expected;
  }
  return false;
}

function mediaBranch(port: Port, input: string): boolean {
  let query = input.trim().toLowerCase();
  const negate = query.startsWith('not ');
  if (negate) query = query.slice(4).trim();
  if (query.startsWith('only ')) query = query.slice(5).trim();

  const type = /^([a-z-]+)/.exec(query)?.[1];
  let matches = type === undefined || type === 'all' || type === 'screen';
  if (type === 'print' || query === '') matches = false;

  const features = [...query.matchAll(/\(([^)]+)\)/g)].map((match) => match[1]!);
  if (features.length > 0) matches = matches && features.every((feature) => mediaFeature(port, feature));
  return negate ? !matches : matches;
}

function object(port: Port, value: unknown): object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw port.error('TypeError', 'Illegal invocation');
  }
  return value;
}

export const globalsDriver: Driver = {
  open: (port) => {
    const states = new WeakMap<object, MediaState>();
    const eventTarget = port.source('window.EventTarget');
    const mediaState = (value: unknown): [object, MediaState] => {
      const target = object(port, value);
      const state = states.get(target);
      if (!state) throw port.error('TypeError', 'Illegal invocation');
      return [target, state];
    };
    const listener = (target: object, action: string, callback: unknown): void => {
      const method = Reflect.get(Object.getPrototypeOf(port.node('globals.media.proto')) as object, `${action}EventListener`);
      if (typeof method !== 'function') throw port.error('TypeError', 'Illegal invocation');
      Reflect.apply(method, target, ['change', callback]);
    };
    const makeMedia = (args: readonly unknown[]): object => {
      if (typeof eventTarget !== 'function') throw port.error('TypeError', 'EventTarget is unavailable');
      const target = Reflect.construct(eventTarget, []) as object;
      Object.setPrototypeOf(target, object(port, port.node('globals.media.proto')));
      states.set(target, { media: String(args[0]), onchange: null });
      return target;
    };
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        switch (item.op) {
          case 'source': {
            const source = port.source(String(item.source));
            return typeof source === 'function' ? Reflect.apply(source, self, args) : undefined;
          }
          case 'computed-style': {
            // BMS pR(): background-color: <SystemColor> !important → getComputedStyle.backgroundColor.
            // Replace jsdom sandbox defaults with a profile-keyed palette (leave 947d9249).
            const source = port.source(String(item.source ?? 'window.getComputedStyle'));
            if (typeof source !== 'function') return undefined;
            const style = Reflect.apply(source, self, args);
            if (style === null || style === undefined || typeof style !== 'object') return style;
            const palette = item.palette;
            if (!palette) return style;
            return wrapComputedStyle(style, args[0], systemColorLookup(palette));
          }
          case 'match-media': {
            // Always use emulated MediaQueryList. Host jsdom matchMedia is desktop-biased
            // (pointer:fine / hover:hover) and ignores navigator.maxTouchPoints — Android BMS
            // sensors read coarse/none (real iV266) and dual-id tables may gate on that surface.
            return makeMedia(args);
          }
          case 'media': {
            const [, state] = mediaState(self);
            if (item.field === 'matches') {
              return state.media.split(',').some((branch) => mediaBranch(port, branch));
            }
            if (item.field === 'media') return state.media;
            if (item.field === 'onchange') return state.onchange;
            throw new TypeError('globals media field invalid');
          }
          case 'media-onchange': {
            const [target, state] = mediaState(self);
            if (typeof state.onchange === 'function') listener(target, 'remove', state.onchange);
            state.onchange = typeof args[0] === 'function' ? args[0] : null;
            if (typeof state.onchange === 'function') listener(target, 'add', state.onchange);
            return undefined;
          }
          case 'media-listener': {
            const [target] = mediaState(self);
            listener(target, item.action === 'remove' ? 'remove' : 'add', args[0]);
            return undefined;
          }
          case 'illegal': throw port.error('TypeError', 'Illegal constructor');
          default: throw new TypeError(`globals Driver op invalid:${item.op}`);
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
