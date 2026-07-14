import { jsonCopy } from '../core/json.js';
import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Shape, Support } from '../core/types.js';
import type { FnShape, Key, Ref } from '../shape/types.js';
import type { FnTell, ProbeFlags, ProbeKey, ProbeSnapshot } from '../probe/diff.js';

type RawOp = Record<string, JsonValue>;

interface Counts {
  functions: number;
  descriptors: number;
  prototypes: number;
  orders: number;
}

function record(value: JsonValue | undefined): RawOp | undefined {
  return value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object'
    ? value as RawOp
    : undefined;
}

function ref(value: JsonValue | undefined): Ref | undefined {
  const item = record(value);
  if (typeof item?.path === 'string') return { path: item.path };
  if (typeof item?.node === 'string') return { node: item.node };
  return undefined;
}

function keyText(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function targetPath(id: string): string | undefined {
  const path = id === 'window' || id.startsWith('window.') ? id : `window.${id}`;
  return /^window(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(path) ? path : undefined;
}

function fnKeys(tell: FnTell, current: FnShape): string[] {
  if (typeof tell.ownNames !== 'string') return [...current.keys];
  const captured = [...new Set(tell.ownNames.split(',').filter(Boolean))].sort();
  const wanted = new Set(captured);
  return [
    ...current.keys.filter((name) => wanted.delete(name)),
    ...captured.filter((name) => wanted.has(name)),
  ];
}

function functionShape(tell: FnTell, current: FnShape, preserveKeys = false): FnShape {
  return {
    name: typeof tell.name === 'string' ? tell.name : current.name,
    length: Number.isSafeInteger(tell.length) && tell.length! >= 0 ? tell.length! : current.length,
    native: typeof tell.toStringNative === 'boolean' ? tell.toStringNative : current.native,
    constructable: current.constructable,
    hasPrototype: typeof tell.hasPrototype === 'boolean' ? tell.hasPrototype : current.hasPrototype,
    keys: preserveKeys ? [...current.keys] : fnKeys(tell, current),
  };
}

function parsedFunctionShape(value: JsonValue | undefined): FnShape | undefined {
  const item = record(value);
  if (!item || typeof item.name !== 'string' || !Number.isSafeInteger(item.length)
    || typeof item.native !== 'boolean' || typeof item.constructable !== 'boolean'
    || typeof item.hasPrototype !== 'boolean' || !Array.isArray(item.keys)
    || item.keys.some((name) => typeof name !== 'string')) return undefined;
  return item as unknown as FnShape;
}

function nodePaths(ops: readonly RawOp[]): Map<string, string> {
  const paths = new Map<string, string>();
  const pathOf = (value: JsonValue | undefined): string | undefined => {
    const valueRef = ref(value);
    return valueRef && ('path' in valueRef ? valueRef.path : paths.get(valueRef.node));
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const op of ops) {
      if (op.op === 'prop' && typeof op.key === 'string') {
        const owner = pathOf(op.target);
        const desc = record(op.desc);
        const stored = desc?.kind === 'data' ? record(desc.value) : undefined;
        const valueRef = ref(stored?.ref);
        if (owner && valueRef && 'node' in valueRef && !paths.has(valueRef.node)) {
          paths.set(valueRef.node, `${owner}.${op.key}`);
          changed = true;
        }
      }
      if (op.op === 'alloc' && op.kind === 'function' && typeof op.id === 'string') {
        const owner = paths.get(op.id);
        const prototype = ref(op.prototype);
        if (owner && prototype && 'node' in prototype && !paths.has(prototype.node)) {
          paths.set(prototype.node, `${owner}.prototype`);
          changed = true;
        }
      }
    }
  }
  return paths;
}

function lower(input: Shape, snapshot: ProbeSnapshot): { ops: JsonValue[]; counts: Counts } {
  const ops = jsonCopy(input.ops) as JsonValue[];
  const rawOps = ops.map((op) => record(op)!);
  const paths = nodePaths(rawOps);
  const counts: Counts = { functions: 0, descriptors: 0, prototypes: 0, orders: 0 };
  const pathOf = (value: JsonValue | undefined): string | undefined => {
    const valueRef = ref(value);
    return valueRef && ('path' in valueRef ? valueRef.path : paths.get(valueRef.node));
  };
  const refForPath = (path: string): Ref => {
    for (const [node, resolved] of paths) if (resolved === path) return { node };
    return { path };
  };
  const matches = (value: JsonValue | undefined, path: string): boolean => pathOf(value) === path;
  const allocation = (value: JsonValue | undefined): RawOp | undefined => {
    const valueRef = ref(value);
    if (!valueRef || !('node' in valueRef)) return undefined;
    return rawOps.find((op) => op.op === 'alloc' && op.kind === 'function' && op.id === valueRef.node);
  };
  const property = (owner: string, name: string): RawOp | undefined => rawOps.find((op) => (
    op.op === 'prop' && matches(op.target, owner) && keyText(op.key) === name
  ));
  const setAllocationShape = (op: RawOp | undefined, tell: FnTell | undefined): boolean => {
    const current = parsedFunctionShape(op?.shape);
    if (!op || !tell || !current) return false;
    op.shape = functionShape(tell, current, true) as unknown as JsonValue;
    counts.functions++;
    return true;
  };
  const setFunctionProperty = (
    owner: string,
    name: string,
    part: 'value' | 'get' | 'set',
    tell: FnTell | null | undefined,
  ): boolean => {
    if (!tell) return false;
    const shaped = rawOps.find((op) => op.op === 'fn' && matches(op.target, owner)
      && op.key === name && op.part === part);
    const current = parsedFunctionShape(shaped?.shape);
    if (shaped && current) {
      shaped.shape = functionShape(tell, current) as unknown as JsonValue;
      counts.functions++;
      return true;
    }
    const prop = property(owner, name);
    const desc = record(prop?.desc);
    const stored = part === 'value' && desc?.kind === 'data'
      ? record(desc.value)
      : part !== 'value' && desc?.kind === 'accessor'
        ? desc[part]
        : undefined;
    return setAllocationShape(allocation(part === 'value' ? record(stored)?.ref : stored), tell);
  };
  const setFunctionPath = (path: string, tell: FnTell | undefined): boolean => {
    if (!tell) return false;
    const shaped = rawOps.find((op) => op.op === 'fn' && matches(op.target, path) && op.key === undefined);
    const current = parsedFunctionShape(shaped?.shape);
    if (shaped && current) {
      shaped.shape = functionShape(tell, current) as unknown as JsonValue;
      counts.functions++;
      return true;
    }
    const split = path.lastIndexOf('.');
    return split >= 'window'.length
      ? setFunctionProperty(path.slice(0, split), path.slice(split + 1), 'value', tell)
      : false;
  };
  const applyFlags = (desc: RawOp, flags: ProbeFlags | undefined, fields: readonly string[]): boolean => {
    let changed = false;
    for (const field of fields) {
      const value = flags?.[field as keyof ProbeFlags];
      if (typeof value === 'boolean') {
        desc[field] = value;
        changed = true;
      }
    }
    return changed;
  };
  const setDescriptor = (owner: string, name: string, observed: ProbeKey): void => {
    const desc = record(property(owner, name)?.desc);
    if (!desc || desc.kind !== observed.type) return;
    const fields = desc.kind === 'data'
      ? ['writable', 'enumerable', 'configurable']
      : ['enumerable', 'configurable'];
    if (applyFlags(desc, observed.flags, fields)) counts.descriptors++;
  };
  const symbol = (value: string): Key | undefined => {
    const match = value.match(/^Symbol\(Symbol\.([A-Za-z]+)\)$/);
    return match?.[1] === undefined ? undefined : { symbol: match[1] };
  };

  for (const target of snapshot.targets || []) {
    if (!target || target.resolved !== true || typeof target.id !== 'string') continue;
    const owner = targetPath(target.id);
    if (!owner) continue;
    if (target.category === 'function') {
      setFunctionPath(owner, target.fn);
      continue;
    }
    for (const [name, observed] of Object.entries(target.keys || {})) {
      setDescriptor(owner, name, observed);
      setFunctionProperty(owner, name, 'value', observed.fn);
      setFunctionProperty(owner, name, 'get', observed.accessor?.get);
      setFunctionProperty(owner, name, 'set', observed.accessor?.set);
    }
    const proto = rawOps.find((op) => op.op === 'proto' && matches(op.target, owner));
    const parent = target.protoChain?.[0];
    if (proto && typeof parent === 'string') {
      const parentPath = parent === 'null' ? null : targetPath(parent);
      if (parentPath !== undefined) {
        proto.value = parentPath === null ? null : refForPath(parentPath) as unknown as JsonValue;
        counts.prototypes++;
      }
    }
    const order = rawOps.find((op) => op.op === 'order' && matches(op.target, owner));
    if (order && Array.isArray(target.ownKeys) && Array.isArray(target.symbolKeys)) {
      const symbols = target.symbolKeys.map(symbol);
      if (symbols.every((item): item is Key => item !== undefined)) {
        order.keys = [...target.ownKeys, ...symbols] as unknown as JsonValue;
        counts.orders++;
      }
    }
  }
  return { ops, counts };
}

function captured(count: number): Support {
  return count > 0 ? 'captured' : 'unsupported';
}

export function probeShape(input: Shape, snapshot: ProbeSnapshot): Shape {
  const { ops, counts } = lower(input, snapshot);
  const { hash: _hash, ...body } = input;
  const total = counts.functions + counts.descriptors + counts.prototypes + counts.orders;
  return parseShape(seal({
    ...body,
    // The structural probe cannot supply executable values for every observed key.
    // Keep the hybrid Shape derived and expose exactly which probe dimensions were lowered.
    level: 'derived' as const,
    ops,
    support: {
      ...input.support,
      structure: 'derived' as const,
      'probe.structure': captured(total),
      'probe.functions': captured(counts.functions),
      'probe.descriptors': captured(counts.descriptors),
      'probe.prototypes': captured(counts.prototypes),
      'probe.order': captured(counts.orders),
    },
  }));
}
