import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Shape } from '../core/types.js';
import type { Driver } from '../engine/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { pluginsShape } from './plugins.js';
import { fnShape, refProp } from './ops.js';

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
  rev: '1',
  requires: ['plugins'],
  build: ({ shape }) => ({
    binds: specs(shape).map(([name]) => {
      const source = `window.${name}`;
      return {
        slot: `globals.${name}`,
        driver: 'globals',
        config: { source },
        sources: [source],
      };
    }),
    support: { 'globals.source': 'emulated' },
  }),
};

function config(value: JsonValue | undefined): { source: string } {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || typeof value.source !== 'string') {
    throw new TypeError('globals Driver config invalid');
  }
  return { source: value.source };
}

export const globalsDriver: Driver = {
  open: (port) => ({
    call: (raw, self, args) => {
      const source = port.source(config(raw).source);
      return typeof source === 'function' ? Reflect.apply(source, self, args) : undefined;
    },
  }),
};
