import { createHash } from 'node:crypto';
import { MimicError } from '../core/error.js';
import { canonical } from '../core/canonical.js';
import { deepFreeze, jsonCopy } from '../core/json.js';
import type { JsonValue, Plan } from '../core/types.js';
import { checkContribution } from '../shape/check.js';
import type { Op, PlanBind } from '../shape/types.js';
import { validateGraph } from './graph.js';
import { isTrustedPlan, trustPlan } from './trusted.js';

type ObjectValue = Record<string, JsonValue>;

function fail(reason: string): never {
  throw new MimicError({ phase: 'parse', code: 'BAD_PLAN', message: `Plan 非法:${reason}` });
}

function object(value: JsonValue | undefined, name: string): ObjectValue {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') return fail(`${name} 必须是对象`);
  return value;
}

function exact(value: ObjectValue, allowed: readonly string[], required: readonly string[], name: string): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${name}.${key} 未定义`);
  for (const key of required) if (!(key in value)) fail(`${name}.${key} 缺失`);
}

function text(value: JsonValue | undefined, name: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value || (pattern && !pattern.test(value))) return fail(`${name} 非法`);
  return value;
}

function ref(value: JsonValue | undefined, name: string): { id: string; hash: string } {
  const item = object(value, name);
  exact(item, ['id', 'hash'], ['id', 'hash'], name);
  return { id: text(item.id, `${name}.id`), hash: text(item.hash, `${name}.hash`, /^[a-f0-9]{64}$/) };
}

export function parsePlan(input: unknown): Plan<Op, PlanBind> {
  if (isTrustedPlan(input)) return input;
  let clean: JsonValue;
  try {
    clean = jsonCopy(input);
  } catch (cause) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PLAN', message: 'Plan 不是纯 JSON', cause });
  }
  const root = object(clean, 'plan');
  exact(root,
    ['schema', 'id', 'synthetic', 'profile', 'shape', 'page', 'boot', 'task', 'engine', 'catalog', 'features', 'operations', 'binds', 'support'],
    ['schema', 'id', 'profile', 'shape', 'boot', 'task', 'engine', 'catalog', 'features', 'operations', 'binds', 'support'],
    'plan');
  if (root.schema !== 2) fail('schema 必须为 2');
  if ('synthetic' in root && root.synthetic !== true) fail('plan.synthetic 非法');
  const id = text(root.id, 'plan.id', /^[a-f0-9]{64}$/);
  ref(root.profile, 'plan.profile');
  if ('page' in root) ref(root.page, 'plan.page');
  const shape = object(root.shape, 'plan.shape');
  exact(shape, ['id', 'hash', 'level'], ['id', 'hash', 'level'], 'plan.shape');
  text(shape.id, 'plan.shape.id');
  text(shape.hash, 'plan.shape.hash', /^[a-f0-9]{64}$/);
  if (shape.level !== 'captured' && shape.level !== 'derived') fail('plan.shape.level 非法');
  ref(root.catalog, 'plan.catalog');
  const engine = object(root.engine, 'plan.engine');
  exact(engine, ['id', 'hash'], ['id', 'hash'], 'plan.engine');
  text(engine.id, 'plan.engine.id');
  text(engine.hash, 'plan.engine.hash');

  const boot = object(root.boot, 'plan.boot');
  exact(boot, ['url', 'html', 'cookies'], ['url', 'html', 'cookies'], 'plan.boot');
  const url = text(boot.url, 'plan.boot.url');
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) fail('plan.boot.url 非法');
  } catch (error) {
    if (error instanceof MimicError) throw error;
    fail('plan.boot.url 非法');
  }
  if (typeof boot.html !== 'string') fail('plan.boot.html 非法');
  if (!Array.isArray(boot.cookies) || boot.cookies.some((cookie) => typeof cookie !== 'string')) fail('plan.boot.cookies 非法');
  if (!['run', 'capture', 'diagnose', 'probe'].includes(String(root.task))) fail('plan.task 非法');
  if (!Array.isArray(root.features) || root.features.some((feature) => typeof feature !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(feature))) {
    fail('plan.features 非法');
  }
  const features = new Set(root.features as string[]);
  if (features.size !== root.features.length) fail('plan.features 重复');
  if (!Array.isArray(root.operations) || !Array.isArray(root.binds)) fail('plan operations/binds 必须是数组');

  const operations: Op[] = (root.operations as JsonValue[]).map((raw, index) => {
    const item = object(raw, `plan.operations.${index}`);
    const feature = text(item.feature, `plan.operations.${index}.feature`);
    if (feature !== '_shape' && !features.has(feature)) fail(`operation feature 未注册:${feature}`);
    const draft: ObjectValue = Object.create(null) as ObjectValue;
    for (const [key, value] of Object.entries(item)) if (key !== 'feature') draft[key] = value;
    const operation = checkContribution({ operations: [draft] }).operations?.[0];
    if (!operation) fail(`operation 解析失败:${index}`);
    return { ...operation, feature };
  });
  const binds: PlanBind[] = (root.binds as JsonValue[]).map((raw, index) => {
    const item = object(raw, `plan.binds.${index}`);
    const feature = text(item.feature, `plan.binds.${index}.feature`);
    if (!features.has(feature)) fail(`bind feature 未注册:${feature}`);
    const draft: ObjectValue = Object.create(null) as ObjectValue;
    for (const [key, value] of Object.entries(item)) if (key !== 'feature') draft[key] = value;
    const bind = checkContribution({ binds: [draft] }).binds?.[0];
    if (!bind) fail(`bind 解析失败:${index}`);
    return { ...bind, feature };
  });
  const contribution = checkContribution({ support: root.support });
  const body: ObjectValue = Object.create(null) as ObjectValue;
  for (const [key, value] of Object.entries(root)) if (key !== 'id') body[key] = value;
  const expected = createHash('sha256').update(canonical(body)).digest('hex');
  if (expected !== id) fail('content id 不匹配');
  validateGraph(operations, binds, { phase: 'parse', ordered: true });

  return trustPlan(deepFreeze(jsonCopy({
    ...root,
    operations,
    binds,
    support: contribution.support || {},
  }) as unknown as Plan<Op, PlanBind>));
}
