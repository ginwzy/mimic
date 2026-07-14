import { dataDriver } from '../drivers/data.js';
import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { Shape } from '../core/types.js';
import type { Driver } from '../engine/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, ctor, fn, refProp, tag } from './ops.js';
import { viewShape } from './view.js';

const SCREEN = ['availWidth', 'availHeight', 'width', 'height', 'colorDepth', 'pixelDepth', 'availLeft', 'availTop'] as const;

function operations(): DraftOp[] {
  const screen = { node: 'screen.proto' } as const;
  const orientation = { node: 'screen.orientation.proto' } as const;
  return [
    { op: 'alloc', id: 'screen.proto', kind: 'object' },
    { op: 'alloc', id: 'screen.instance', kind: 'event' },
    { op: 'alloc', id: 'screen.orientation.proto', kind: 'object' },
    { op: 'alloc', id: 'screen.orientation.instance', kind: 'event' },
    ctor('screen.ctor', 'screen.ctor', 'Screen', screen),
    ctor('screen.orientation.ctor', 'screen.orientation.ctor', 'ScreenOrientation', orientation),
    fn('screen.window.get', 'screen.window', 'get screen'),
    ...SCREEN.map((name) => fn(`screen.${name}.get`, `screen.${name}`, `get ${name}`)),
    fn('screen.orientation.get', 'screen.orientation', 'get orientation'),
    fn('screen.extended.get', 'screen.extended', 'get isExtended'),
    fn('screen.onchange.get', 'screen.onchange.get', 'get onchange'),
    fn('screen.onchange.set', 'screen.onchange.set', 'set onchange', 1),
    fn('screen.orientation.type.get', 'screen.orientation.type', 'get type'),
    fn('screen.orientation.angle.get', 'screen.orientation.angle', 'get angle'),
    fn('screen.orientation.onchange.get', 'screen.orientation.onchange.get', 'get onchange'),
    fn('screen.orientation.onchange.set', 'screen.orientation.onchange.set', 'set onchange', 1),
    fn('screen.orientation.lock', 'screen.orientation.lock', 'lock', 1),
    fn('screen.orientation.unlock', 'screen.orientation.unlock', 'unlock'),
    { op: 'proto', target: screen, value: { path: 'window.EventTarget.prototype' } },
    { op: 'proto', target: { node: 'screen.instance' }, value: screen },
    { op: 'proto', target: orientation, value: { path: 'window.EventTarget.prototype' } },
    { op: 'proto', target: { node: 'screen.orientation.instance' }, value: orientation },
    refProp({ path: 'window' }, 'Screen', 'screen.ctor'),
    refProp({ path: 'window' }, 'ScreenOrientation', 'screen.orientation.ctor'),
    refProp(screen, 'constructor', 'screen.ctor'),
    refProp(orientation, 'constructor', 'screen.orientation.ctor'),
    tag(screen, 'Screen'),
    tag(orientation, 'ScreenOrientation'),
    ...SCREEN.map((name) => accessor(screen, name, `screen.${name}.get`)),
    accessor(screen, 'orientation', 'screen.orientation.get'),
    accessor(screen, 'onchange', 'screen.onchange.get', 'screen.onchange.set'),
    accessor(screen, 'isExtended', 'screen.extended.get'),
    accessor(orientation, 'type', 'screen.orientation.type.get'),
    accessor(orientation, 'angle', 'screen.orientation.angle.get'),
    accessor(orientation, 'onchange', 'screen.orientation.onchange.get', 'screen.orientation.onchange.set'),
    refProp(orientation, 'lock', 'screen.orientation.lock', true),
    refProp(orientation, 'unlock', 'screen.orientation.unlock', true),
    accessor({ path: 'window' }, 'screen', 'screen.window.get'),
    {
      op: 'order', target: screen,
      keys: [...SCREEN, 'orientation', 'constructor', 'onchange', 'isExtended', { symbol: 'toStringTag' }],
    },
    {
      op: 'order', target: orientation,
      keys: ['type', 'angle', 'onchange', 'lock', 'unlock', 'constructor', { symbol: 'toStringTag' }],
    },
  ];
}

export function screenShape(input: Shape): Shape {
  const shape = viewShape(input);
  if (shape.features.includes('screen')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'screen'].sort(),
    ops: [...shape.ops, ...operations()],
    support: {
      ...shape.support,
      'screen.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'screen.api': 'emulated',
    },
  }));
}

export const screenFeature: Feature = {
  id: 'screen',
  rev: '1',
  requires: ['view'],
  build: ({ profile }) => ({
    binds: [
      { slot: 'screen.ctor', driver: 'screen', config: { op: 'illegal' } },
      { slot: 'screen.orientation.ctor', driver: 'screen', config: { op: 'illegal' } },
      { slot: 'screen.window', driver: 'screen', config: { op: 'node', id: 'screen.instance' } },
      ...SCREEN.map((name) => ({ slot: `screen.${name}`, driver: 'screen', config: { op: 'value', value: profile.screen[name] } })),
      { slot: 'screen.orientation', driver: 'screen', config: { op: 'node', id: 'screen.orientation.instance' } },
      { slot: 'screen.extended', driver: 'screen', config: { op: 'value', value: false } },
      { slot: 'screen.onchange.get', driver: 'screen', config: { op: 'handler-get', name: 'onchange' } },
      { slot: 'screen.onchange.set', driver: 'screen', config: { op: 'handler-set', name: 'onchange' } },
      { slot: 'screen.orientation.type', driver: 'screen', config: { op: 'value', value: profile.screen.orientation.type } },
      { slot: 'screen.orientation.angle', driver: 'screen', config: { op: 'value', value: profile.screen.orientation.angle } },
      { slot: 'screen.orientation.onchange.get', driver: 'screen', config: { op: 'handler-get', name: 'onchange' } },
      { slot: 'screen.orientation.onchange.set', driver: 'screen', config: { op: 'handler-set', name: 'onchange' } },
      { slot: 'screen.orientation.lock', driver: 'screen', config: { op: 'resolve' } },
      { slot: 'screen.orientation.unlock', driver: 'screen', config: { op: 'void' } },
    ],
    support: { 'screen.data': profile.evidence.screen.support },
  }),
};

export const screenDriver: Driver = dataDriver;
