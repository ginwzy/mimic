import type { DraftOp, FnShape, Key, Ref } from '../shape/types.js';
import type { JsonValue } from '../core/types.js';

export function fnShape(name: string, length = 0, constructable = false, hasPrototype = false): FnShape {
  return {
    name, length, native: true, constructable, hasPrototype,
    keys: hasPrototype ? ['length', 'name', 'prototype'] : ['length', 'name'],
  };
}

export function fn(id: string, slot: string, name: string, length = 0): DraftOp {
  return { op: 'alloc', id, kind: 'function', slot, shape: fnShape(name, length) };
}

export function ctor(id: string, slot: string, name: string, prototype: Ref): DraftOp {
  return { op: 'alloc', id, kind: 'function', slot, shape: fnShape(name, 0, true, true), prototype };
}

export function refProp(target: Ref, key: Key, node: string, enumerable = false): DraftOp {
  return {
    op: 'prop', target, key,
    desc: { kind: 'data', value: { ref: { node } }, writable: true, enumerable, configurable: true },
  };
}

export function valueProp(target: Ref, key: Key, value: JsonValue, enumerable = false, writable = false): DraftOp {
  return {
    op: 'prop', target, key,
    desc: { kind: 'data', value: { json: value }, writable, enumerable, configurable: true },
  };
}

export function accessor(target: Ref, key: string, getter: string, setter?: string): DraftOp {
  return {
    op: 'prop', target, key,
    desc: {
      kind: 'accessor', get: { node: getter }, ...(setter ? { set: { node: setter } } : {}),
      enumerable: true, configurable: true,
    },
  };
}

export function tag(target: Ref, name: string): DraftOp {
  return valueProp(target, { symbol: 'toStringTag' }, name);
}
