import type { Bind, JsonValue, Shape } from '../core/types.js';
import { registerTouchList, touchListInitialization, touchListItems } from '../engine/touch.js';
import type { Driver, Port } from '../engine/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, fn, fnShape, refProp, tag } from './ops.js';

const TOUCH_FIELDS = [
  'identifier', 'target',
  'screenX', 'screenY', 'clientX', 'clientY', 'pageX', 'pageY',
  'radiusX', 'radiusY', 'rotationAngle', 'force',
] as const;

type TouchField = typeof TOUCH_FIELDS[number];
type TouchState = Record<TouchField, unknown>;

function receiver(port: Port, value: unknown): object {
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') return value;
  throw port.error('TypeError', 'Illegal invocation');
}

function listItems(port: Port, self: unknown): readonly unknown[] {
  const items = touchListItems(receiver(port, self));
  if (!items) throw port.error('TypeError', 'Illegal invocation');
  return items;
}

function driverConfig(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || typeof value.op !== 'string') {
    throw new TypeError('touch Driver config invalid');
  }
  return value;
}

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

function finiteNumber(value: unknown, fallback = 0): number {
  const output = Number(value);
  return Number.isFinite(output) ? output : fallback;
}

function touchState(port: Port, init: unknown): TouchState {
  if (init === null || typeof init !== 'object') {
    throw port.error('TypeError', "Failed to construct 'Touch': parameter 1 is not of type 'TouchInit'.");
  }
  const values = init as Record<string, unknown>;
  if (!Object.hasOwn(values, 'identifier') || !Object.hasOwn(values, 'target')) {
    throw port.error('TypeError', "Failed to construct 'Touch': identifier and target are required.");
  }
  return {
    identifier: Math.trunc(finiteNumber(values.identifier)),
    target: values.target,
    screenX: finiteNumber(values.screenX),
    screenY: finiteNumber(values.screenY),
    clientX: finiteNumber(values.clientX),
    clientY: finiteNumber(values.clientY),
    pageX: finiteNumber(values.pageX),
    pageY: finiteNumber(values.pageY),
    radiusX: finiteNumber(values.radiusX),
    radiusY: finiteNumber(values.radiusY),
    rotationAngle: finiteNumber(values.rotationAngle),
    force: finiteNumber(values.force),
  };
}

export const touchDriver: Driver = {
  open: (port) => {
    const touches = new WeakMap<object, TouchState>();

    const point = (self: unknown): TouchState => {
      const state = touches.get(receiver(port, self));
      if (!state) throw port.error('TypeError', 'Illegal invocation');
      return state;
    };

    return {
      call: (raw, self, args) => {
        const item = driverConfig(raw);
        switch (item.op) {
          case 'touch-get':
            return point(self)[String(item.name) as TouchField];
          case 'list-length':
            return listItems(port, self).length;
          case 'list-item': {
            const items = listItems(port, self);
            const index = Number(args[0]) >>> 0;
            return items[index] ?? null;
          }
          default:
            throw new TypeError(`touch Driver op invalid:${String(item.op)}`);
        }
      },
      construct: (raw, args) => {
        const item = driverConfig(raw);
        switch (item.op) {
          case 'touch': {
            const target = port.make('touch.Touch.proto');
            if (target === null || typeof target !== 'object') throw port.error('TypeError', 'Touch allocation failed');
            touches.set(target, touchState(port, args[0]));
            return target;
          }
          case 'touch-list': {
            const items = touchListInitialization(args);
            if (!items) throw port.error('TypeError', "Failed to construct 'TouchList': Illegal constructor");
            const target = port.make('touch.TouchList.proto');
            if (target === null || typeof target !== 'object') throw port.error('TypeError', 'TouchList allocation failed');
            const snapshot = registerTouchList(target, items);
            for (let index = 0; index < snapshot.length; index++) {
              Object.defineProperty(target, String(index), {
                value: snapshot[index], writable: false, enumerable: true, configurable: true,
              });
            }
            return target;
          }
          default:
            throw new TypeError(`touch Driver construct invalid:${String(item.op)}`);
        }
      },
    };
  },
};
