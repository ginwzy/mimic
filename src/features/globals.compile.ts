import { describeCoverage } from './capabilities.js';
import type { JsonValue, Shape } from '../core/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, ctor, fn, fnShape, refProp, tag } from './ops.js';
import { resolveSystemColors, systemColorsOrigin } from '../environment/identity.js';

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

export function operations(shape: Shape): DraftOp[] {
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

export const globalsFeature: Feature = {
  id: 'globals',
  jobKeys: [],
  describe: ({ profile }, support) => describeCoverage(support, {
    // The host Shape supplies this flag even when the Chrome Feature is absent.
    'window.secure-context': 'constant',
    'globals.api': 'partial',
    'globals.source': 'partial',
    'globals.system-colors': 'constant',
  }, { 'globals.system-colors': systemColorsOrigin(profile) }),
  rev: '4',
  requires: ['plugins'],
  build: ({ shape, profile }) => {
    const palette = resolveSystemColors(profile);
    const fromProfile = profile.systemColors !== undefined;
    const binds = specs(shape).map(([name]) => {
      const source = `window.${name}`;
      if (name === 'matchMedia') {
        return {
          slot: `globals.${name}`,
          driver: 'globals',
          config: { op: 'match-media', source },
          sources: [source, 'window.EventTarget', 'window.innerWidth', 'window.innerHeight', 'window.navigator.maxTouchPoints'],
        };
      }
      if (name === 'getComputedStyle') {
        return {
          slot: `globals.${name}`,
          driver: 'globals',
          config: { op: 'computed-style', source, palette: palette as unknown as JsonValue },
          sources: [source],
        };
      }
      return {
        slot: `globals.${name}`,
        driver: 'globals',
        config: { op: 'source', source },
        sources: [source],
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
      support: {
        'globals.source': 'emulated',
        // System-color rgb map for BMS pR (PL236); shape does not declare this key.
        'globals.system-colors': fromProfile ? 'captured' : 'derived',
      },
    };
  },
};
