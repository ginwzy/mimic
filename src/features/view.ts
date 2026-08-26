import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Shape, Support, WindowData } from '../core/types.js';
import type { Driver } from '../engine/types.js';
import { dataDriver } from '../engine/data.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, ctor, fn, refProp, tag } from './ops.js';

const GEOMETRY = ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio'] as const;
const VIEW_VALUES = ['offsetLeft', 'offsetTop', 'pageLeft', 'pageTop', 'width', 'height', 'scale'] as const;

function operations(): DraftOp[] {
  return [
    { op: 'alloc', id: 'view.proto', kind: 'object' },
    { op: 'alloc', id: 'view.instance', kind: 'event' },
    ctor('view.ctor', 'view.ctor', 'VisualViewport', { node: 'view.proto' }),
    ...GEOMETRY.map((name) => fn(`view.window.${name}.get`, `view.window.${name}`, `get ${name}`)),
    ...VIEW_VALUES.map((name) => fn(`view.${name}.get`, `view.${name}`, `get ${name}`)),
    fn('view.window.get', 'view.window', 'get visualViewport'),
    fn('view.onresize.get', 'view.onresize.get', 'get onresize'),
    fn('view.onresize.set', 'view.onresize.set', 'set onresize', 1),
    fn('view.onscroll.get', 'view.onscroll.get', 'get onscroll'),
    fn('view.onscroll.set', 'view.onscroll.set', 'set onscroll', 1),
    { op: 'proto', target: { node: 'view.proto' }, value: { path: 'window.EventTarget.prototype' } },
    { op: 'proto', target: { node: 'view.instance' }, value: { node: 'view.proto' } },
    refProp({ path: 'window' }, 'VisualViewport', 'view.ctor'),
    refProp({ node: 'view.proto' }, 'constructor', 'view.ctor'),
    tag({ node: 'view.proto' }, 'VisualViewport'),
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
