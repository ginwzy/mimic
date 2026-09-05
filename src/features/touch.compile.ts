import { describeCoverage } from './capabilities.js';
import type { Bind, Shape } from '../core/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, fn, fnShape, refProp, tag } from './ops.js';

import { TOUCH_FIELDS } from './touch.shared.js';

function shapeHasTouchSlots(shape: Shape): boolean {
  return shape.ops.some((raw) => {
    if (raw === null || Array.isArray(raw) || typeof raw !== 'object') return false;
    const op = raw as DraftOp;
    return op.op === 'alloc' && op.kind === 'function'
      && op.id === 'touch.Touch.ctor' && op.slot === 'touch.Touch.ctor';
  });
}

function touchInterfaceOps(): DraftOp[] {
  const touch = { node: 'touch.Touch.proto' } as const;
  const list = { node: 'touch.TouchList.proto' } as const;
  const ops: DraftOp[] = [
    { op: 'alloc', id: 'touch.Touch.proto', kind: 'object' },
    {
      op: 'alloc', id: 'touch.Touch.ctor', kind: 'function', slot: 'touch.Touch.ctor',
      shape: fnShape('Touch', 1, true, true), prototype: touch,
    },
    { op: 'proto', target: touch, value: { path: 'window.Object.prototype' } },
    refProp({ path: 'window' }, 'Touch', 'touch.Touch.ctor'),
    refProp(touch, 'constructor', 'touch.Touch.ctor'),
  ];
  for (const field of TOUCH_FIELDS) {
    const id = `touch.Touch.${field}.get`;
    ops.push(fn(id, id, `get ${field}`), accessor(touch, field, id));
  }
  ops.push(
    tag(touch, 'Touch'),
    {
      op: 'order', target: touch,
      keys: [...TOUCH_FIELDS, 'constructor', { symbol: 'toStringTag' }],
    },
    { op: 'alloc', id: 'touch.TouchList.proto', kind: 'object' },
    {
      op: 'alloc', id: 'touch.TouchList.ctor', kind: 'function', slot: 'touch.TouchList.ctor',
      shape: fnShape('TouchList', 0, true, true), prototype: list,
    },
    { op: 'proto', target: list, value: { path: 'window.Object.prototype' } },
    refProp({ path: 'window' }, 'TouchList', 'touch.TouchList.ctor'),
    refProp(list, 'constructor', 'touch.TouchList.ctor'),
    fn('touch.TouchList.length.get', 'touch.TouchList.length.get', 'get length'),
    accessor(list, 'length', 'touch.TouchList.length.get'),
    fn('touch.TouchList.item', 'touch.TouchList.item', 'item', 1),
    refProp(list, 'item', 'touch.TouchList.item', true),
    {
      op: 'prop', target: list, key: { symbol: 'iterator' },
      desc: {
        kind: 'data', value: { ref: { path: 'window.Array.prototype.values' } },
        writable: true, enumerable: false, configurable: true,
      },
    },
    tag(list, 'TouchList'),
    {
      op: 'order', target: list,
      keys: ['length', 'item', 'constructor', { symbol: 'toStringTag' }, { symbol: 'iterator' }],
    },
  );
  return ops;
}

export function operations(shape: Shape): DraftOp[] {
  return shape.target.form === 'mobile' ? touchInterfaceOps() : [];
}

function touchBinds(): Bind[] {
  return [
    { slot: 'touch.Touch.ctor', driver: 'touch', config: { op: 'touch' } },
    ...TOUCH_FIELDS.map((name) => ({
      slot: `touch.Touch.${name}.get`, driver: 'touch', config: { op: 'touch-get', name },
    })),
    { slot: 'touch.TouchList.ctor', driver: 'touch', config: { op: 'touch-list' } },
    { slot: 'touch.TouchList.length.get', driver: 'touch', config: { op: 'list-length' } },
    { slot: 'touch.TouchList.item', driver: 'touch', config: { op: 'list-item' } },
  ];
}

export const touchFeature: Feature = {
  id: 'touch',
  describe: ({ shape }, support) => describeCoverage(support, {
    'touch.api': shape.target.form === 'mobile' ? 'partial' : 'structure',
  }),
  rev: '2',
  requires: ['screen'],
  build: ({ shape }) => {
    if (shape.target.form !== 'mobile') {
      return { support: { 'touch.api': 'shape-only' } };
    }
    return {
      ...(!shapeHasTouchSlots(shape) ? { operations: touchInterfaceOps() } : {}),
      binds: touchBinds(),
      support: { 'touch.api': 'emulated' },
    };
  },
};
