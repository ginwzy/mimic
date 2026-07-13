import { createHash } from 'node:crypto';
import { canonical } from './canonical.js';
import { deepFreeze, jsonCopy } from './json.js';
import type { Hash, JsonValue } from './types.js';

export function digest(value: unknown): Hash {
  const clean = jsonCopy(value);
  return createHash('sha256').update(canonical(clean)).digest('hex') as Hash;
}

export function seal<T extends object>(body: T): Readonly<T & { hash: Hash }> {
  const clean = jsonCopy(body) as unknown as T;
  if (Object.hasOwn(clean, 'hash')) throw new TypeError('seal body 不能包含 hash');
  return deepFreeze(jsonCopy({ ...clean, hash: digest(clean) }) as unknown as T & { hash: Hash });
}

export function validHash(value: { hash: string }): boolean {
  const body: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'hash') Object.defineProperty(body, key, { value: child, enumerable: true, writable: true, configurable: true });
  }
  return digest(body) === value.hash;
}
