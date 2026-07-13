import type { JsonValue, Support, SupportMap } from '../core/types.js';
import { jsonCopy } from '../core/json.js';
import type { BlockRule, Contribution, Desc, DraftOp, EngineManifest, FnPart, FnShape, Key, Ref } from './types.js';

type ObjectValue = Record<string, JsonValue>;

const SUPPORT = new Set<Support>(['captured', 'derived', 'emulated', 'shape-only', 'unsupported']);

function fail(path: string, reason: string): never {
  throw new TypeError(`${path}:${reason}`);
}

function object(value: JsonValue, path: string): ObjectValue {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail(path, 'expected object');
  return value;
}

function exact(value: ObjectValue, path: string, allowed: readonly string[], required: readonly string[]): void {
  const allow = new Set(allowed);
  for (const key of Object.keys(value)) if (!allow.has(key)) fail(`${path}/${key}`, 'unknown field');
  for (const key of required) if (!(key in value)) fail(`${path}/${key}`, 'required field');
}

function string(value: JsonValue | undefined, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'expected non-empty string');
  return value;
}

function source(value: JsonValue | undefined, path: string): string {
  const name = string(value, path);
  if (!/^window(?:\.[A-Za-z_$][\w$]*)+$/.test(name)) fail(path, 'invalid window source path');
  return name;
}

function bool(value: JsonValue | undefined, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected boolean');
  return value;
}

function ref(value: JsonValue | undefined, path: string): Ref {
  const item = object(value as JsonValue, path);
  if ('path' in item) {
    exact(item, path, ['path'], ['path']);
    const target = string(item.path, `${path}/path`);
    if (!/^window(?:\.[A-Za-z_$][\w$]*)*$/.test(target)) fail(`${path}/path`, 'invalid window path');
    return { path: target };
  }
  exact(item, path, ['node'], ['node']);
  return { node: string(item.node, `${path}/node`) };
}

function key(value: JsonValue | undefined, path: string): Key {
  if (typeof value === 'string') return value;
  const item = object(value as JsonValue, path);
  exact(item, path, ['symbol'], ['symbol']);
  const symbol = string(item.symbol, `${path}/symbol`);
  const known = new Set(['asyncIterator', 'hasInstance', 'isConcatSpreadable', 'iterator', 'match', 'matchAll', 'replace', 'search', 'species', 'split', 'toPrimitive', 'toStringTag', 'unscopables']);
  if (!symbol.startsWith('for:') && !known.has(symbol)) fail(`${path}/symbol`, 'unknown symbol');
  return { symbol };
}

function fnShape(value: JsonValue | undefined, path: string): FnShape {
  const item = object(value as JsonValue, path);
  exact(item, path, ['name', 'length', 'native', 'constructable', 'hasPrototype', 'keys'],
    ['name', 'length', 'native', 'constructable', 'hasPrototype', 'keys']);
  if (!Number.isSafeInteger(item.length) || (item.length as number) < 0) fail(`${path}/length`, 'expected non-negative safe integer');
  if (!Array.isArray(item.keys) || item.keys.some((name) => typeof name !== 'string')) fail(`${path}/keys`, 'expected string array');
  if (new Set(item.keys).size !== item.keys.length) fail(`${path}/keys`, 'duplicate key');
  return {
    name: typeof item.name === 'string' ? item.name : fail(`${path}/name`, 'expected string'),
    length: item.length as number,
    native: bool(item.native, `${path}/native`),
    constructable: bool(item.constructable, `${path}/constructable`),
    hasPrototype: bool(item.hasPrototype, `${path}/hasPrototype`),
    keys: item.keys as string[],
  };
}

function desc(value: JsonValue | undefined, path: string): Desc {
  const item = object(value as JsonValue, path);
  if (item.kind === 'data') {
    exact(item, path, ['kind', 'value', 'writable', 'enumerable', 'configurable'],
      ['kind', 'value', 'writable', 'enumerable', 'configurable']);
    const stored = object(item.value as JsonValue, `${path}/value`);
    let storedValue;
    if ('json' in stored) {
      exact(stored, `${path}/value`, ['json'], ['json']);
      storedValue = { json: stored.json };
    } else {
      exact(stored, `${path}/value`, ['ref'], ['ref']);
      storedValue = { ref: ref(stored.ref, `${path}/value/ref`) };
    }
    return {
      kind: 'data', value: storedValue,
      writable: bool(item.writable, `${path}/writable`),
      enumerable: bool(item.enumerable, `${path}/enumerable`),
      configurable: bool(item.configurable, `${path}/configurable`),
    };
  }
  if (item.kind === 'accessor') {
    exact(item, path, ['kind', 'get', 'set', 'enumerable', 'configurable'], ['kind', 'enumerable', 'configurable']);
    return {
      kind: 'accessor',
      ...('get' in item ? { get: ref(item.get, `${path}/get`) } : {}),
      ...('set' in item ? { set: ref(item.set, `${path}/set`) } : {}),
      enumerable: bool(item.enumerable, `${path}/enumerable`),
      configurable: bool(item.configurable, `${path}/configurable`),
    };
  }
  return fail(`${path}/kind`, 'expected data or accessor');
}

function operation(value: JsonValue, path: string): DraftOp {
  const item = object(value, path);
  switch (item.op) {
    case 'alloc': {
      if (item.kind === 'object' || item.kind === 'event') {
        exact(item, path, ['op', 'id', 'kind'], ['op', 'id', 'kind']);
        return { op: 'alloc', id: string(item.id, `${path}/id`), kind: item.kind };
      }
      if (item.kind === 'proxy') {
        exact(item, path, ['op', 'id', 'kind', 'source', 'symbols'], ['op', 'id', 'kind', 'source', 'symbols']);
        if (!Array.isArray(item.symbols) || item.symbols.length === 0) fail(`${path}/symbols`, 'expected non-empty array');
        const symbols = item.symbols.map((value, index) => string(value, `${path}/symbols/${index}`));
        if (new Set(symbols).size !== symbols.length) fail(`${path}/symbols`, 'duplicate symbol description');
        return {
          op: 'alloc', id: string(item.id, `${path}/id`), kind: 'proxy',
          source: ref(item.source, `${path}/source`), symbols,
        };
      }
      if (item.kind === 'function') {
        exact(item, path, ['op', 'id', 'kind', 'shape', 'slot', 'prototype'], ['op', 'id', 'kind', 'shape']);
        const shape = fnShape(item.shape, `${path}/shape`);
        if ('prototype' in item && !shape.hasPrototype) fail(`${path}/prototype`, 'function without prototype cannot bind one');
        return {
          op: 'alloc', id: string(item.id, `${path}/id`), kind: 'function',
          shape,
          ...('slot' in item ? { slot: string(item.slot, `${path}/slot`) } : {}),
          ...('prototype' in item ? { prototype: ref(item.prototype, `${path}/prototype`) } : {}),
        };
      }
      return fail(`${path}/kind`, 'expected object, event, proxy, or function');
    }
    case 'proto':
      exact(item, path, ['op', 'target', 'value'], ['op', 'target', 'value']);
      return { op: 'proto', target: ref(item.target, `${path}/target`), value: item.value === null ? null : ref(item.value, `${path}/value`) };
    case 'prop':
      exact(item, path, ['op', 'target', 'key', 'desc'], ['op', 'target', 'key', 'desc']);
      return { op: 'prop', target: ref(item.target, `${path}/target`), key: key(item.key, `${path}/key`), desc: desc(item.desc, `${path}/desc`) };
    case 'drop':
      exact(item, path, ['op', 'target', 'key'], ['op', 'target', 'key']);
      return { op: 'drop', target: ref(item.target, `${path}/target`), key: key(item.key, `${path}/key`) };
    case 'fn': {
      exact(item, path, ['op', 'target', 'key', 'part', 'shape'], ['op', 'target', 'shape']);
      if (('key' in item) !== ('part' in item)) fail(path, 'fn key and part must appear together');
      const part = item.part;
      if (part !== undefined && part !== 'value' && part !== 'get' && part !== 'set') fail(`${path}/part`, 'unknown function part');
      return {
        op: 'fn',
        target: ref(item.target, `${path}/target`),
        ...('key' in item ? { key: key(item.key, `${path}/key`), part: part as FnPart } : {}),
        shape: fnShape(item.shape, `${path}/shape`),
      };
    }
    case 'order': {
      exact(item, path, ['op', 'target', 'keys'], ['op', 'target', 'keys']);
      if (!Array.isArray(item.keys)) fail(`${path}/keys`, 'expected array');
      const keys = item.keys.map((value, index) => key(value, `${path}/keys/${index}`));
      const ids = keys.map((value) => JSON.stringify(value));
      if (new Set(ids).size !== ids.length) fail(`${path}/keys`, 'duplicate key');
      return { op: 'order', target: ref(item.target, `${path}/target`), keys };
    }
    default:
      return fail(`${path}/op`, 'unknown operation');
  }
}

function supportMap(value: JsonValue | undefined, path: string): SupportMap {
  const item = object(value as JsonValue, path);
  const output = Object.create(null) as SupportMap;
  for (const [name, level] of Object.entries(item)) {
    if (!/^[a-z][a-z0-9.-]*$/.test(name)) fail(`${path}/${name}`, 'invalid support name');
    if (!SUPPORT.has(level as Support)) fail(`${path}/${name}`, 'unknown support level');
    Object.defineProperty(output, name, { value: level, enumerable: true, writable: true, configurable: true });
  }
  return output;
}

export function checkContribution(input: unknown): Contribution {
  const value = object(jsonCopy(input), '$');
  exact(value, '$', ['operations', 'binds', 'support'], []);
  if ('operations' in value && !Array.isArray(value.operations)) fail('$/operations', 'expected array');
  if ('binds' in value && !Array.isArray(value.binds)) fail('$/binds', 'expected array');
  const operations = (value.operations as JsonValue[] | undefined)?.map((item, index) => operation(item, `$/operations/${index}`));
  const binds = (value.binds as JsonValue[] | undefined)?.map((raw, index) => {
    const item = object(raw, `$/binds/${index}`);
    exact(item, `$/binds/${index}`, ['slot', 'driver', 'config', 'sources'], ['slot', 'driver']);
    if ('sources' in item && !Array.isArray(item.sources)) fail(`$/binds/${index}/sources`, 'expected array');
    const sources = (item.sources as JsonValue[] | undefined)?.map((value, sourceIndex) => (
      source(value, `$/binds/${index}/sources/${sourceIndex}`)
    ));
    if (sources && (sources.length === 0 || new Set(sources).size !== sources.length)) {
      fail(`$/binds/${index}/sources`, 'expected non-empty unique paths');
    }
    return {
      slot: string(item.slot, `$/binds/${index}/slot`),
      driver: string(item.driver, `$/binds/${index}/driver`),
      ...('config' in item ? { config: item.config } : {}),
      ...(sources ? { sources } : {}),
    };
  });
  return {
    ...(operations ? { operations } : {}),
    ...(binds ? { binds } : {}),
    ...('support' in value ? { support: supportMap(value.support, '$/support') } : {}),
  };
}

export function checkSupport(input: unknown): SupportMap {
  return supportMap(jsonCopy(input), '$');
}

export function checkManifest(input: unknown): EngineManifest {
  const value = object(jsonCopy(input), '$');
  exact(value, '$', ['id', 'hash', 'blocked'], ['id', 'hash', 'blocked']);
  if (!Array.isArray(value.blocked)) fail('$/blocked', 'expected array');
  const blocked: BlockRule[] = value.blocked.map((raw, index) => {
    const item = object(raw, `$/blocked/${index}`);
    exact(item, `$/blocked/${index}`, ['op', 'target', 'key', 'part', 'reason'], ['op', 'reason']);
    if (!['alloc', 'proto', 'prop', 'drop', 'fn', 'order'].includes(String(item.op))) fail(`$/blocked/${index}/op`, 'unknown operation');
    if (item.op === 'alloc' && ('target' in item || 'key' in item)) fail(`$/blocked/${index}`, 'alloc rule cannot target ref/key');
    if (item.op !== 'prop' && item.op !== 'drop' && item.op !== 'fn' && 'key' in item) fail(`$/blocked/${index}/key`, 'key only applies to prop/drop/fn');
    if ('part' in item && item.op !== 'fn') fail(`$/blocked/${index}/part`, 'part only applies to fn');
    if (item.op === 'fn' && (('key' in item) !== ('part' in item))) fail(`$/blocked/${index}`, 'fn key and part must appear together');
    const part = item.part;
    if (part !== undefined && part !== 'value' && part !== 'get' && part !== 'set') fail(`$/blocked/${index}/part`, 'unknown function part');
    return {
      op: item.op as DraftOp['op'],
      ...('target' in item ? { target: ref(item.target, `$/blocked/${index}/target`) } : {}),
      ...('key' in item ? { key: key(item.key, `$/blocked/${index}/key`) } : {}),
      ...('part' in item ? { part: part as FnPart } : {}),
      reason: string(item.reason, `$/blocked/${index}/reason`),
    };
  });
  return { id: string(value.id, '$/id'), hash: string(value.hash, '$/hash'), blocked };
}
