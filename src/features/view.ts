import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Shape, Support, WindowData } from '../core/types.js';
import type { Driver } from '../engine/types.js';
import { dataDriver } from '../drivers/data.js';
import type { DraftOp, Feature, FnShape } from '../shape/types.js';

const method = (name: string, length = 0, constructable = false, hasPrototype = false): FnShape => ({
  name,
  length,
  native: true,
  constructable,
  hasPrototype,
  keys: hasPrototype ? ['length', 'name', 'prototype'] : ['length', 'name'],
});

const get = (id: string, slot: string, name: string): DraftOp => ({
  op: 'alloc', id, kind: 'function', slot, shape: method(`get ${name}`),
});

const prop = (target: { path: string } | { node: string }, key: string | { symbol: string }, value: { node: string }): DraftOp => ({
  op: 'prop', target, key,
  desc: { kind: 'data', value: { ref: value }, writable: true, enumerable: false, configurable: true },
});

const accessor = (
  target: { path: string } | { node: string },
  key: string,
  getter: string,
  setter?: string,
): DraftOp => ({
  op: 'prop', target, key,
  desc: {
    kind: 'accessor', get: { node: getter }, ...(setter ? { set: { node: setter } } : {}),
    enumerable: true, configurable: true,
  },
});

const GEOMETRY = ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio'] as const;
const VIEW_VALUES = ['offsetLeft', 'offsetTop', 'pageLeft', 'pageTop', 'width', 'height', 'scale'] as const;

function operations(): DraftOp[] {
  const ops: DraftOp[] = [
    { op: 'alloc', id: 'view.proto', kind: 'object' },
    { op: 'alloc', id: 'view.instance', kind: 'event' },
    {
      op: 'alloc', id: 'view.ctor', kind: 'function', slot: 'view.ctor',
      shape: method('VisualViewport', 0, true, true), prototype: { node: 'view.proto' },
    },
    ...GEOMETRY.map((name) => get(`view.window.${name}.get`, `view.window.${name}`, name)),
    ...VIEW_VALUES.map((name) => get(`view.${name}.get`, `view.${name}`, name)),
    get('view.window.get', 'view.window', 'visualViewport'),
    get('view.onresize.get', 'view.onresize.get', 'onresize'),
    { op: 'alloc', id: 'view.onresize.set', kind: 'function', slot: 'view.onresize.set', shape: method('set onresize', 1) },
    get('view.onscroll.get', 'view.onscroll.get', 'onscroll'),
    { op: 'alloc', id: 'view.onscroll.set', kind: 'function', slot: 'view.onscroll.set', shape: method('set onscroll', 1) },
    { op: 'proto', target: { node: 'view.proto' }, value: { path: 'window.EventTarget.prototype' } },
    { op: 'proto', target: { node: 'view.instance' }, value: { node: 'view.proto' } },
    prop({ path: 'window' }, 'VisualViewport', { node: 'view.ctor' }),
    {
      op: 'prop', target: { node: 'view.proto' }, key: 'constructor',
      desc: { kind: 'data', value: { ref: { node: 'view.ctor' } }, writable: true, enumerable: false, configurable: true },
    },
    {
      op: 'prop', target: { node: 'view.proto' }, key: { symbol: 'toStringTag' },
      desc: { kind: 'data', value: { json: 'VisualViewport' }, writable: false, enumerable: false, configurable: true },
    },
    ...GEOMETRY.map((name) => accessor({ path: 'window' }, name, `view.window.${name}.get`)),
    ...VIEW_VALUES.map((name) => accessor({ node: 'view.proto' }, name, `view.${name}.get`)),
    accessor({ node: 'view.proto' }, 'onresize', 'view.onresize.get', 'view.onresize.set'),
    accessor({ node: 'view.proto' }, 'onscroll', 'view.onscroll.get', 'view.onscroll.set'),
    accessor({ path: 'window' }, 'visualViewport', 'view.window.get'),
    {
      op: 'order', target: { node: 'view.proto' },
      keys: [...VIEW_VALUES, 'onresize', 'onscroll', 'constructor', { symbol: 'toStringTag' }],
    },
  ];
  return ops;
}

export function viewShape(shape: Shape): Shape {
  if (shape.features.includes('view')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'view'].sort(),
    ops: [...shape.ops, ...operations()],
    support: {
      ...shape.support,
      'view.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'view.api': 'emulated',
    },
  }));
}

type ValueConfig = { op: 'value'; value: JsonValue } | { op: 'source'; path: string };

function geometry(window: WindowData | undefined, name: typeof GEOMETRY[number]): ValueConfig {
  return window
    ? { op: 'value', value: window[name] }
    : { op: 'source', path: `window.${name}` };
}

export const viewFeature: Feature = {
  id: 'view',
  rev: '1',
  build: ({ profile }) => {
    const viewData: Record<typeof VIEW_VALUES[number], number> = {
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
      width: profile.window?.innerWidth ?? 0,
      height: profile.window?.innerHeight ?? 0,
      scale: 1,
    };
    const data: Support = profile.window ? profile.evidence.window.support : 'emulated';
    return {
      binds: [
        { slot: 'view.ctor', driver: 'view', config: { op: 'illegal' } },
        ...GEOMETRY.map((name) => ({
          slot: `view.window.${name}`,
          driver: 'view',
          config: geometry(profile.window, name),
          ...(profile.window ? {} : { sources: [`window.${name}`] }),
        })),
        ...VIEW_VALUES.map((name) => ({ slot: `view.${name}`, driver: 'view', config: { op: 'value', value: viewData[name] } })),
        { slot: 'view.window', driver: 'view', config: { op: 'node', id: 'view.instance' } },
        { slot: 'view.onresize.get', driver: 'view', config: { op: 'handler-get', name: 'onresize' } },
        { slot: 'view.onresize.set', driver: 'view', config: { op: 'handler-set', name: 'onresize' } },
        { slot: 'view.onscroll.get', driver: 'view', config: { op: 'handler-get', name: 'onscroll' } },
        { slot: 'view.onscroll.set', driver: 'view', config: { op: 'handler-set', name: 'onscroll' } },
      ],
      support: { 'view.data': data },
    };
  },
};

export const viewDriver: Driver = dataDriver;
