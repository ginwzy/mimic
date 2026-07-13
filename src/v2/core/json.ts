import type { JsonValue } from './types.js';

function fail(path: string, reason: string): never {
  throw new TypeError(`${path}:${reason}`);
}

function copy(value: unknown, path: string, parents: Set<object>): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'number must be finite');
    if (Object.is(value, -0)) fail(path, 'negative zero is not JSON round-trip safe');
    return value;
  }
  if (typeof value !== 'object') fail(path, `unsupported ${typeof value}`);
  if (parents.has(value)) fail(path, 'cyclic value');

  parents.add(value);
  try {
    if (Array.isArray(value)) {
      const symbols = Object.getOwnPropertySymbols(value);
      if (symbols.length) fail(path, 'symbol keys are not JSON safe');
      const names = Object.getOwnPropertyNames(value);
      const expected = new Set<string>(['length']);
      for (let index = 0; index < value.length; index++) expected.add(String(index));
      if (names.some((name) => !expected.has(name))) fail(path, 'array has extra properties');
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) fail(`${path}/${index}`, 'sparse array');
        const descriptor = Object.getOwnPropertyDescriptor(value, index)!;
        if (!descriptor.enumerable || !('value' in descriptor)) fail(`${path}/${index}`, 'array item must be enumerable data');
        output.push(copy(descriptor.value, `${path}/${index}`, parents));
      }
      return output;
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail(path, 'object must be plain');
    if (Object.getOwnPropertySymbols(value).length) fail(path, 'symbol keys are not JSON safe');

    const output: Record<string, JsonValue> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable) fail(`${path}/${key}`, 'property must be enumerable');
      if (!('value' in descriptor)) fail(`${path}/${key}`, 'accessor is not JSON safe');
      Object.defineProperty(output, key, {
        value: copy(descriptor.value, `${path}/${key}`, parents),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return output;
  } finally {
    parents.delete(value);
  }
}

export function jsonCopy<T extends JsonValue>(value: T): T;
export function jsonCopy(value: unknown): JsonValue;
export function jsonCopy(value: unknown): JsonValue {
  return copy(value, '$', new Set<object>());
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && 'value' in descriptor) deepFreeze(descriptor.value);
    }
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
