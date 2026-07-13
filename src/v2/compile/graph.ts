import { MimicError } from '../core/error.js';
import { canonical } from '../core/canonical.js';
import type { ErrorCode, JsonValue } from '../core/types.js';
import type { DraftOp, Key, Op, PlanBind, Ref } from '../shape/types.js';

export const STAGE: Readonly<Record<Op['op'], number>> = Object.freeze({
  alloc: 0,
  proto: 1,
  drop: 2,
  prop: 2,
  fn: 3,
  order: 4,
});

interface GraphOptions {
  readonly phase: 'compile' | 'parse';
  readonly drivers?: ReadonlySet<string>;
  readonly ordered?: boolean;
}

function fail(options: GraphOptions, code: ErrorCode, message: string, details?: JsonValue): never {
  if (options.phase === 'parse') {
    throw new MimicError({
      phase: 'parse',
      code: 'BAD_PLAN',
      message: `Plan 非法:${message}`,
      ...(details === undefined ? {} : { details }),
    });
  }
  throw new MimicError({
    phase: 'compile',
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

const refValue = (ref: Ref): JsonValue => (
  'path' in ref ? ['path', ref.path] : ['node', ref.node]
);

const keyValue = (key: Key): JsonValue => (
  typeof key === 'string' ? ['string', key] : ['symbol', key.symbol]
);

const write = (value: JsonValue): string => canonical(value);

function propertyWrite(target: Ref, key: Key): string {
  return write(['property', refValue(target), keyValue(key)]);
}

function callableWrite(target: Ref, key: Key, part: 'value' | 'get' | 'set'): string {
  return write(['callable', refValue(target), [keyValue(key), part]]);
}

function directProperty(ref: Ref): { owner: Ref; key: string } | undefined {
  if (!('path' in ref) || ref.path === 'window') return undefined;
  const split = ref.path.lastIndexOf('.');
  if (split < 'window'.length) return undefined;
  return { owner: { path: ref.path.slice(0, split) }, key: ref.path.slice(split + 1) };
}

function writesOf(operation: DraftOp): string[] {
  if (operation.op === 'alloc') return [write(['alloc', ['node', operation.id]])];
  if (operation.op === 'fn') {
    if (operation.key !== undefined) {
      return [callableWrite(operation.target, operation.key, operation.part!)];
    }
    const writes = [write(['fn', refValue(operation.target)])];
    const property = directProperty(operation.target);
    if (property) writes.push(callableWrite(property.owner, property.key, 'value'));
    return writes;
  }
  if (operation.op === 'prop' || operation.op === 'drop') {
    return [
      propertyWrite(operation.target, operation.key),
      callableWrite(operation.target, operation.key, 'value'),
      callableWrite(operation.target, operation.key, 'get'),
      callableWrite(operation.target, operation.key, 'set'),
    ];
  }
  return [write([operation.op, refValue(operation.target)])];
}

function refsOf(operation: DraftOp): Ref[] {
  if (operation.op === 'alloc') {
    if (operation.kind === 'proxy') return [operation.source];
    return operation.kind === 'function' && operation.prototype ? [operation.prototype] : [];
  }
  const refs: Ref[] = [operation.target];
  if (operation.op === 'proto' && operation.value) refs.push(operation.value);
  if (operation.op === 'prop') {
    if (operation.desc.kind === 'data' && 'ref' in operation.desc.value) refs.push(operation.desc.value.ref);
    if (operation.desc.kind === 'accessor') {
      if (operation.desc.get) refs.push(operation.desc.get);
      if (operation.desc.set) refs.push(operation.desc.set);
    }
  }
  return refs;
}

export function validateGraph(
  operations: readonly Op[],
  binds: readonly PlanBind[],
  options: GraphOptions,
): void {
  if (options.ordered) {
    let previous = -1;
    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index]!;
      const stage = STAGE[operation.op];
      if (stage < previous) {
        fail(options, 'BAD_PLAN', `operation stage 顺序错误:${index}`, {
          index,
          previous,
          next: stage,
          op: operation.op,
        });
      }
      previous = stage;
    }
  }

  const writes = new Map<string, string>();
  const allocated = new Map<string, Extract<DraftOp, { op: 'alloc' }>>();
  for (const operation of operations) {
    for (const item of writesOf(operation)) {
      const owner = writes.get(item);
      if (owner !== undefined) {
        fail(options, 'WRITE_CONFLICT', `Shape 写入冲突:${item}`, {
          write: item,
          first: owner,
          second: operation.feature,
        });
      }
      writes.set(item, operation.feature);
    }
    if (operation.op === 'alloc') allocated.set(operation.id, operation);
  }

  const callable = (ref: Ref, feature: string, use: string): void => {
    if (!('node' in ref)) return;
    const allocation = allocated.get(ref.node);
    if (!allocation || allocation.kind !== 'function') {
      fail(options, 'BAD_PLAN', `${use} 必须引用 function node:${ref.node}`, {
        feature,
        node: ref.node,
        use,
      });
    }
  };

  for (const operation of operations) {
    for (const ref of refsOf(operation)) {
      if ('node' in ref && !allocated.has(ref.node)) {
        fail(options, 'BAD_PLAN', `引用未分配 node:${ref.node}`, {
          feature: operation.feature,
          node: ref.node,
        });
      }
    }
    if (operation.op === 'fn' && operation.key === undefined) callable(operation.target, operation.feature, 'fn');
    if (operation.op === 'prop' && operation.desc.kind === 'accessor') {
      if (operation.desc.get) callable(operation.desc.get, operation.feature, 'accessor.get');
      if (operation.desc.set) callable(operation.desc.set, operation.feature, 'accessor.set');
    }
  }

  const declared = new Map<string, { node: string; feature: string }>();
  for (const operation of operations) {
    if (operation.op !== 'alloc' || operation.kind !== 'function' || operation.slot === undefined) continue;
    const previous = declared.get(operation.slot);
    if (previous) {
      fail(options, 'WRITE_CONFLICT', `Driver slot 声明冲突:${operation.slot}`, {
        slot: operation.slot,
        first: previous.feature,
        second: operation.feature,
      });
    }
    declared.set(operation.slot, { node: operation.id, feature: operation.feature });
  }

  const slots = new Map<string, string>();
  for (const bind of binds) {
    if (options.drivers && !options.drivers.has(bind.driver)) {
      fail(options, 'NO_DRIVER', `缺少 Driver:${bind.driver}`, {
        feature: bind.feature,
        slot: bind.slot,
        driver: bind.driver,
      });
    }
    if (!declared.has(bind.slot)) {
      fail(options, 'BAD_PLAN', `Driver bind 没有 function slot:${bind.slot}`, {
        feature: bind.feature,
        slot: bind.slot,
      });
    }
    const owner = slots.get(bind.slot);
    if (owner !== undefined) {
      fail(options, 'WRITE_CONFLICT', `Driver slot 冲突:${bind.slot}`, {
        slot: bind.slot,
        first: owner,
        second: bind.feature,
      });
    }
    slots.set(bind.slot, bind.feature);
  }
  for (const [slot, declaration] of declared) {
    if (!slots.has(slot)) {
      fail(options, 'BAD_PLAN', `function slot 没有 Driver bind:${slot}`, {
        feature: declaration.feature,
        node: declaration.node,
        slot,
      });
    }
  }
}
