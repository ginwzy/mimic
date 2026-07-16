import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Shape } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { pluginsShape } from './plugins.js';
import { accessor, ctor, fn, fnShape, refProp, tag } from './ops.js';

type Spec = readonly [name: string, length: number];

const COMMON: readonly Spec[] = [
  ['alert', 0],
  ['atob', 1],
  ['blur', 0],
  ['btoa', 1],
  ['cancelAnimationFrame', 1],
  ['cancelIdleCallback', 1],
  ['captureEvents', 0],
  ['clearInterval', 0],
  ['clearTimeout', 0],
  ['close', 0],
  ['confirm', 0],
  ['createImageBitmap', 1],
  ['find', 0],
  ['focus', 0],
  ['getComputedStyle', 1],
  ['getSelection', 0],
  ['matchMedia', 1],
  ['moveBy', 2],
  ['moveTo', 2],
  ['open', 0],
  ['postMessage', 1],
  ['print', 0],
  ['prompt', 0],
  ['queueMicrotask', 1],
  ['releaseEvents', 0],
  ['reportError', 1],
  ['requestAnimationFrame', 1],
  ['requestIdleCallback', 1],
  ['resizeBy', 2],
  ['resizeTo', 2],
  ['scroll', 0],
  ['scrollBy', 0],
  ['scrollTo', 0],
  ['setInterval', 1],
  ['setTimeout', 1],
  ['stop', 0],
  ['structuredClone', 1],
  ['webkitCancelAnimationFrame', 1],
  ['webkitRequestAnimationFrame', 1],
  ['getScreenDetails', 0],
  ['showDirectoryPicker', 0],
  ['showOpenFilePicker', 0],
  ['showSaveFilePicker', 0],
];

const CHROME: readonly Spec[] = [
  ['queryLocalFonts', 0],
  ['webkitRequestFileSystem', 3],
  ['webkitResolveLocalFileSystemURL', 2],
];

const EVENTS: readonly Spec[] = [
  ['addEventListener', 2],
  ['dispatchEvent', 1],
  ['removeEventListener', 2],
];

function specs(shape: Shape): readonly Spec[] {
  return shape.target.host === 'chrome' ? [...COMMON, ...CHROME] : COMMON;
}

function operations(shape: Shape): DraftOp[] {
  const ops: DraftOp[] = [];
  for (const [name, length] of specs(shape)) {
    const id = `globals.${name}`;
    ops.push(
      { op: 'alloc', id, kind: 'function', slot: id, shape: fnShape(name, length) },
      refProp({ path: 'window' }, name, id, true),
    );
  }
  for (const [name, length] of EVENTS) {
    ops.push({
      op: 'fn',
      target: { path: `window.EventTarget.prototype.${name}` },
      shape: fnShape(name, length),
    });
  }
  return ops;
}

function mediaOperations(): DraftOp[] {
  const media = { node: 'globals.media.proto' } as const;
  return [
    { op: 'alloc', id: 'globals.media.proto', kind: 'object' },
    ctor('globals.media.ctor', 'globals.media.ctor', 'MediaQueryList', media),
    fn('globals.media.media.get', 'globals.media.media', 'get media'),
    fn('globals.media.matches.get', 'globals.media.matches', 'get matches'),
    fn('globals.media.onchange.get', 'globals.media.onchange.get', 'get onchange'),
    fn('globals.media.onchange.set', 'globals.media.onchange.set', 'set onchange', 1),
    fn('globals.media.addListener', 'globals.media.addListener', 'addListener', 1),
    fn('globals.media.removeListener', 'globals.media.removeListener', 'removeListener', 1),
    { op: 'proto', target: media, value: { path: 'window.EventTarget.prototype' } },
    refProp({ path: 'window' }, 'MediaQueryList', 'globals.media.ctor'),
    refProp(media, 'constructor', 'globals.media.ctor'),
    accessor(media, 'media', 'globals.media.media.get'),
    accessor(media, 'matches', 'globals.media.matches.get'),
    accessor(media, 'onchange', 'globals.media.onchange.get', 'globals.media.onchange.set'),
    refProp(media, 'addListener', 'globals.media.addListener', true),
    refProp(media, 'removeListener', 'globals.media.removeListener', true),
    tag(media, 'MediaQueryList'),
    {
      op: 'order', target: media,
      keys: ['media', 'matches', 'onchange', 'addListener', 'removeListener', 'constructor', { symbol: 'toStringTag' }],
    },
  ];
}

export function globalsShape(input: Shape): Shape {
  const shape = pluginsShape(input);
  if (shape.features.includes('globals')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'globals'].sort(),
    ops: [...shape.ops, ...operations(shape)],
    support: {
      ...shape.support,
      'globals.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'globals.api': 'shape-only',
    },
  }));
}

export const globalsFeature: Feature = {
  id: 'globals',
  rev: '3',
  requires: ['plugins'],
  build: ({ shape }) => {
    const binds = specs(shape).map(([name]) => {
      const source = `window.${name}`;
      const sources = name === 'matchMedia'
        ? [source, 'window.EventTarget', 'window.innerWidth', 'window.innerHeight', 'window.navigator.maxTouchPoints']
        : [source];
      return {
        slot: `globals.${name}`,
        driver: 'globals',
        config: { op: name === 'matchMedia' ? 'match-media' : 'source', source },
        sources,
      };
    });
    return {
      operations: mediaOperations(),
      binds: [
        ...binds,
        { slot: 'globals.media.ctor', driver: 'globals', config: { op: 'illegal' } },
        { slot: 'globals.media.media', driver: 'globals', config: { op: 'media', field: 'media' } },
        { slot: 'globals.media.matches', driver: 'globals', config: { op: 'media', field: 'matches' } },
        { slot: 'globals.media.onchange.get', driver: 'globals', config: { op: 'media', field: 'onchange' } },
        { slot: 'globals.media.onchange.set', driver: 'globals', config: { op: 'media-onchange' } },
        { slot: 'globals.media.addListener', driver: 'globals', config: { op: 'media-listener', action: 'add' } },
        { slot: 'globals.media.removeListener', driver: 'globals', config: { op: 'media-listener', action: 'remove' } },
      ],
      support: { 'globals.source': 'emulated' },
    };
  },
};

interface Config {
  op: string;
  source?: string;
  field?: string;
  action?: string;
}

interface MediaState {
  media: string;
  onchange: unknown;
}

function config(value: JsonValue | undefined): Config {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || typeof value.op !== 'string') {
    throw new TypeError('globals Driver config invalid');
  }
  return {
    op: value.op,
    ...(typeof value.source === 'string' ? { source: value.source } : {}),
    ...(typeof value.field === 'string' ? { field: value.field } : {}),
    ...(typeof value.action === 'string' ? { action: value.action } : {}),
  };
}

function mediaFeature(port: Port, feature: string): boolean {
  const [rawName, rawValue] = feature.split(':', 2);
  const name = rawName?.trim();
  const value = rawValue?.trim();
  // Live reads: captureSources freezes values before nav/view install, so
  // port.source('window.navigator.maxTouchPoints') stays at jsdom's 0 and
  // Android (pointer:coarse) wrongly reports as fine (BMS iV266).
  const width = Number(port.evaluate('innerWidth'));
  const height = Number(port.evaluate('innerHeight'));
  const touchPoints = Number(port.evaluate('navigator.maxTouchPoints'));

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
