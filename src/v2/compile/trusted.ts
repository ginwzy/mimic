import type { Plan } from '../core/types.js';
import type { Op, PlanBind } from '../shape/types.js';

const TRUSTED = new WeakSet<object>();

export function trustPlan<T extends Plan<Op, PlanBind>>(plan: T): T {
  TRUSTED.add(plan);
  return plan;
}

export function isTrustedPlan(input: unknown): input is Plan<Op, PlanBind> {
  return input !== null && typeof input === 'object' && TRUSTED.has(input);
}
