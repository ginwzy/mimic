import type { JsonValue } from '../core/types.js';
import { registerTouchList, touchListInitialization, touchListItems } from '../engine/touch.js';
import type { Driver, Port } from '../engine/types.js';
import type { TOUCH_FIELDS } from './touch.shared.js';

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
