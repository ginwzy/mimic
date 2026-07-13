import { createHash } from 'node:crypto';
import { MimicError } from '../core/error.js';
import { deepFreeze, jsonCopy } from '../core/json.js';
import { parseJob, parsePage, parseProfile, parseShape } from '../core/parse.js';
import type { JsonValue, Plan, Shape, Support, SupportMap } from '../core/types.js';
import type { BlockRule, CompileInput, DraftOp, Feature, Key, Op, PlanBind, Ref } from '../shape/types.js';
import { checkContribution, checkManifest, checkSupport } from '../shape/check.js';
import { canonical } from '../core/canonical.js';
import { STAGE, validateGraph } from './graph.js';

type SequencedOp = Op & { sequence: number };

interface PreparedShape {
  shape: Shape;
  operations: readonly SequencedOp[];
  cleanOperations: readonly Op[];
  support: Readonly<SupportMap>;
}

const PREPARED_SHAPES = new WeakMap<object, PreparedShape>();
const EMPTY_COOKIES: readonly string[] = Object.freeze([]);

function frozenTree(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor && !frozenTree(descriptor.value, seen)) return false;
  }
  return true;
}

function prepareShape(input: unknown): PreparedShape {
  if (input !== null && typeof input === 'object') {
    const cached = PREPARED_SHAPES.get(input);
    if (cached) return cached;
  }

  const shape = parseShape(jsonCopy(input));
  const contribution = deepFreeze(checkContribution({ operations: shape.ops, support: shape.support }));
  const operations = deepFreeze((contribution.operations || []).map((operation, sequence) => ({
    ...operation,
    feature: '_shape',
    sequence,
  })));
  const cleanOperations = deepFreeze([...operations]
    .sort((left, right) => STAGE[left.op] - STAGE[right.op] || left.sequence - right.sequence)
    .map(({ sequence: _sequence, ...operation }) => operation));
  const support = deepFreeze({ ...(contribution.support || {}) });
  const prepared = Object.freeze({ shape, operations, cleanOperations, support });

  if (input !== null && typeof input === 'object' && frozenTree(input)) PREPARED_SHAPES.set(input, prepared);
  return prepared;
}

function orderFeatures(features: readonly Feature[]): Feature[] {
  const ids = new Set<string>();
  for (const feature of features) {
    if (feature === null || typeof feature !== 'object' || typeof feature.id !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(feature.id) || typeof feature.build !== 'function') {
      throw new TypeError('Feature 必须包含非空 id 和 build 函数');
    }
    if (feature.requires !== undefined && (!Array.isArray(feature.requires) || feature.requires.some((id) => typeof id !== 'string' || !id))) {
      throw new TypeError(`Feature requires 非法:${feature.id}`);
    }
    if (ids.has(feature.id)) {
      throw new MimicError({ phase: 'compile', code: 'DUPLICATE_FEATURE', message: `重复 Feature:${feature.id}` });
    }
    ids.add(feature.id);
  }
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const output: Feature[] = [];

  const visit = (feature: Feature) => {
    if (done.has(feature.id)) return;
    if (visiting.has(feature.id)) {
      throw new MimicError({ phase: 'compile', code: 'FEATURE_CYCLE', message: `Feature 循环依赖:${feature.id}` });
    }
    visiting.add(feature.id);
    for (const required of [...(feature.requires || [])].sort()) {
      const dependency = byId.get(required);
      if (!dependency) throw new MimicError({ phase: 'compile', code: 'NO_FEATURE', message: `缺少 Feature:${required}` });
      visit(dependency);
    }
    visiting.delete(feature.id);
    done.add(feature.id);
    output.push(feature);
  };

  for (const feature of [...features].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) visit(feature);
  return output;
}

const refKey = (ref: Ref): string => ('path' in ref ? `path:${ref.path}` : `node:${ref.node}`);
const keyKey = (key: Key): string => canonical((typeof key === 'string' ? ['string', key] : ['symbol', key.symbol]) as JsonValue);

function targetOf(operation: DraftOp): string {
  if (operation.op === 'alloc') return `node:${operation.id}`;
  return refKey(operation.target);
}

function blockedBy(rule: BlockRule, operation: DraftOp): boolean {
  if (rule.op !== operation.op) return false;
  if (rule.target !== undefined) {
    if (operation.op === 'alloc' || canonical(rule.target as unknown as JsonValue) !== canonical(operation.target as unknown as JsonValue)) return false;
  }
  if (rule.key === undefined) return true;
  if (operation.op !== 'prop' && operation.op !== 'drop' && operation.op !== 'fn') return false;
  if (operation.op === 'fn' && operation.key === undefined) return false;
  if (keyKey(rule.key) !== keyKey(operation.key!)) return false;
  return rule.part === undefined || (operation.op === 'fn' && operation.part === rule.part);
}

const SUPPORT_RANK: Record<Support, number> = {
  unsupported: 0,
  'shape-only': 1,
  emulated: 2,
  derived: 3,
  captured: 4,
};

function compileUnsafe(input: CompileInput): Plan<Op, PlanBind> {
  if (!Array.isArray(input.drivers) || input.drivers.some((id) => typeof id !== 'string' || !id)) {
    throw new TypeError('drivers 必须是非空字符串数组');
  }
  const driverList = deepFreeze(jsonCopy(input.drivers) as string[]);
  const profile = parseProfile(jsonCopy(input.profile));
  if (input.catalog === null || typeof input.catalog !== 'object' || typeof input.catalog.id !== 'string'
    || !/^[a-z][a-z0-9.-]*$/.test(input.catalog.id) || !/^[a-f0-9]{64}$/.test(input.catalog.hash)
    || typeof input.catalog.resolve !== 'function') {
    throw new TypeError('catalog 非法');
  }
  const resolved = input.catalog.resolve(profile.shape);
  if (resolved === null || typeof resolved !== 'object' || !Array.isArray(resolved.features)) throw new TypeError('catalog resolve 结果非法');
  const preparedShape = prepareShape(resolved.shape);
  const shape = preparedShape.shape;
  if (profile.shape.id !== shape.id || profile.shape.hash !== shape.hash) {
    throw new MimicError({ phase: 'compile', code: 'BAD_PLAN', message: 'Catalog 返回的 Shape 与 Profile 引用不匹配' });
  }
  const featureList = resolved.features.map((feature) => Object.freeze({
    id: feature.id,
    rev: feature.rev ?? '1',
    ...(feature.requires === undefined ? {} : { requires: deepFreeze([...feature.requires]) }),
    build: feature.build,
  })) as Feature[];
  const page = input.page === undefined ? undefined : parsePage(jsonCopy(input.page));
  const job = parseJob(jsonCopy(input.job));
  const engine = checkManifest(input.engine);
  const required = checkSupport(input.require === undefined ? {} : input.require);
  const features = orderFeatures(featureList);
  const expectedFeatures = [...shape.features];
  const actualFeatures = features.map((feature) => feature.id).sort();
  if (expectedFeatures.length !== actualFeatures.length || expectedFeatures.some((id, index) => id !== actualFeatures[index])) {
    throw new MimicError({
      phase: 'compile', code: 'BAD_PLAN', message: 'Feature registry 与 Shape 不匹配',
      details: { expected: expectedFeatures, actual: actualFeatures },
    });
  }
  const operations: SequencedOp[] = [...preparedShape.operations];
  const binds: PlanBind[] = [];
  const support = Object.create(null) as SupportMap;
  let sequence = operations.length;

  for (const [name, level] of Object.entries(preparedShape.support)) support[name] = level;

  for (const feature of features) {
    let contribution;
    try {
      contribution = deepFreeze(checkContribution(feature.build.call(undefined, { profile, shape, ...(page ? { page } : {}), job })));
    } catch (cause) {
      throw new MimicError({
        phase: 'compile', code: 'BAD_PLAN', message: `Feature 构建失败:${feature.id}`,
        details: { feature: feature.id, reason: cause instanceof Error ? cause.message : String(cause) },
        cause,
      });
    }
    for (const operation of contribution.operations || []) operations.push({ ...operation, feature: feature.id, sequence: sequence++ });
    for (const bind of contribution.binds || []) binds.push({ ...bind, feature: feature.id });
    for (const [name, level] of Object.entries(contribution.support || {})) {
      if (support[name] !== undefined && support[name] !== level) {
        throw new MimicError({
          phase: 'compile', code: 'WRITE_CONFLICT', message: `Support 重复定义:${name}`,
          details: { feature: feature.id, previous: support[name], next: level },
        });
      }
      support[name] = level;
    }
  }

  const driverIds = new Set(driverList);
  if (driverIds.size !== driverList.length) throw new TypeError('drivers 包含重复 id');
  validateGraph(operations, binds, { phase: 'compile', drivers: driverIds });

  for (const operation of operations) {
    const blocked = engine.blocked.find((rule) => blockedBy(rule, operation));
    if (blocked) {
      throw new MimicError({
        phase: 'compile', code: 'ENGINE_BLOCKED', message: `Engine 无法安装 ${operation.op}:${blocked.reason}`,
        details: { feature: operation.feature, target: targetOf(operation), reason: blocked.reason },
      });
    }
  }

  for (const [name, minimum] of Object.entries(required)) {
    const actual = support[name] || 'unsupported';
    if (SUPPORT_RANK[actual] < SUPPORT_RANK[minimum]) {
      throw new MimicError({
        phase: 'compile', code: 'LOW_SUPPORT', message: `Support 不足:${name}`,
        details: { name, required: minimum, actual },
      });
    }
  }

  const cleanOperations = operations.length === preparedShape.operations.length
    ? preparedShape.cleanOperations
    : deepFreeze(operations
      .sort((left, right) => STAGE[left.op] - STAGE[right.op] || left.sequence - right.sequence)
      .map(({ sequence: _sequence, ...operation }) => operation));
  const body = {
    schema: 2 as const,
    profile: Object.freeze({ id: profile.id, hash: profile.hash }),
    shape: Object.freeze({ id: shape.id, hash: shape.hash, level: shape.level }),
    ...(page ? { page: Object.freeze({ id: page.id, hash: page.hash }) } : {}),
    boot: Object.freeze({
      url: page?.url ?? 'https://example.com/',
      html: page?.html ?? '<!doctype html><html><head></head><body></body></html>',
      cookies: page?.cookies ?? EMPTY_COOKIES,
    }),
    task: job.kind,
    engine: Object.freeze({ id: engine.id, hash: engine.hash }),
    catalog: Object.freeze({ id: input.catalog.id, hash: input.catalog.hash }),
    features: Object.freeze(features.map((feature) => feature.id)),
    operations: cleanOperations,
    binds: deepFreeze(binds),
    support: deepFreeze({ ...support }),
  } satisfies Omit<Plan<Op, PlanBind>, 'id'>;
  const json = canonical(body as unknown as JsonValue);
  const id = createHash('sha256').update(json).digest('hex');
  return Object.freeze({ ...body, id });
}

export function compile(input: CompileInput): Plan<Op, PlanBind> {
  try {
    return compileUnsafe(input);
  } catch (cause) {
    if (cause instanceof MimicError) throw cause;
    throw new MimicError({ phase: 'compile', code: 'BAD_PLAN', message: '无法生成 JSON 安全的 Plan', cause });
  }
}

export interface PlanExplanation {
  id: string;
  profile: string;
  shape: string;
  page?: string;
  task: string;
  engine: string;
  catalog: string;
  features: string[];
  operations: Record<Op['op'], number>;
  drivers: string[];
  support: SupportMap;
}

export function explain(plan: Plan<Op, PlanBind>): PlanExplanation {
  const operations: Record<Op['op'], number> = { alloc: 0, proto: 0, prop: 0, drop: 0, fn: 0, order: 0 };
  for (const operation of plan.operations) operations[operation.op]++;
  return {
    id: plan.id,
    profile: plan.profile.id,
    shape: plan.shape.id,
    ...(plan.page ? { page: plan.page.id } : {}),
    task: plan.task,
    engine: `${plan.engine.id}@${plan.engine.hash}`,
    catalog: `${plan.catalog.id}@${plan.catalog.hash}`,
    features: plan.features.slice(),
    operations,
    drivers: [...new Set(plan.binds.map((bind) => bind.driver))].sort(),
    support: { ...plan.support },
  };
}
