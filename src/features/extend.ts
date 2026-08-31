import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { Shape, Support, SupportMap } from '../core/types.js';
import type { DraftOp } from '../shape/types.js';

export function shapeSupport(shape: Shape): Support {
  return shape.level === 'captured' ? 'captured' : 'derived';
}

/** Append ops/support without claiming another executable Feature. */
export function appendShape(
  input: Shape,
  ops: readonly DraftOp[],
  support: SupportMap,
  extra: readonly string[] = [],
): Shape {
  const { hash: _hash, ...body } = input;
  return parseShape(seal({
    ...body,
    features: [...input.features, ...extra].sort(),
    ops: [...input.ops, ...ops],
    support: { ...input.support, ...support },
  }));
}

/** Append a feature id + ops. Execute catalog must not import this. */
export function extendShape(
  input: Shape,
  id: string,
  ops: readonly DraftOp[],
  support: SupportMap,
  extra: readonly string[] = [],
): Shape {
  if (input.features.includes(id)) return input;
  return appendShape(input, ops, support, [id, ...extra]);
}
