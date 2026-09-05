import { canonical } from '../core/canonical.js';
import type { JsonValue } from '../core/types.js';
import type { DraftOp, FnPart, Key, Ref } from './types.js';

const refValue = (ref: Ref): JsonValue => 'path' in ref ? ['path', ref.path] : ['node', ref.node];
const keyValue = (key: Key): JsonValue => typeof key === 'string' ? ['string', key] : ['symbol', key.symbol];

export function callableWrite(target: Ref, key: Key, part: FnPart): string {
  return canonical(['callable', refValue(target), [keyValue(key), part]]);
}

/** One ownership vocabulary for Shape composition, generic wrappers and Plan validation. */
export function operationWrites(operation: DraftOp): string[] {
  if (operation.op === 'alloc') return [canonical(['alloc', ['node', operation.id]])];
  if (operation.op === 'fn') {
    if (operation.key !== undefined) return [callableWrite(operation.target, operation.key, operation.part!)];
    const writes = [canonical(['fn', refValue(operation.target)])];
    if ('path' in operation.target) {
      const split = operation.target.path.lastIndexOf('.');
      if (split >= 'window'.length) {
        writes.push(callableWrite({ path: operation.target.path.slice(0, split) }, operation.target.path.slice(split + 1), 'value'));
      }
    }
    return writes;
  }
  if (operation.op === 'prop' || operation.op === 'drop') {
    return [
      canonical(['property', refValue(operation.target), keyValue(operation.key)]),
      ...(['value', 'get', 'set'] as const).map(part => callableWrite(operation.target, operation.key, part)),
    ];
  }
  return [canonical([operation.op, refValue(operation.target)])];
}
