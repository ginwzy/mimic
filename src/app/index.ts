import { createHash } from 'node:crypto';
import { Catalog } from '../catalog/index.js';
import { compile } from '../compile/index.js';
import { canonical } from '../core/canonical.js';
import { MimicError } from '../core/error.js';
import { parseJob, parsePage, parseShape } from '../core/parse.js';
import { digest, seal } from '../core/seal.js';
import { isTrustedPage, isTrustedProfile, isTrustedShape } from '../core/trusted.js';
import type {
  Job,
  JsonValue,
  Page,
  Plan,
  Profile,
  Result,
  Shape,
  SupportMap,
} from '../core/types.js';
import type { Op, PlanBind } from '../shape/types.js';
import { checkSupport } from '../shape/check.js';
import { failure, RuntimeApplication } from './runtime.js';
import type { ApplicationOptions, ListKind, ProfilesPort, TaskRequest } from './types.js';

export type {
  ApplicationOptions,
  CaptureLifecycle,
  CaptureOptions,
  ListKind,
  ProfileRecord,
  ProfilesPort,
  RuntimeOptions,
  TaskRequest,
} from './types.js';

interface PlanCacheEntry {
  plan: Plan<Op, PlanBind>;
}

const CATALOG_CACHE_LIMIT = 32;
const PLAN_CACHE_LIMIT = 128;
const PAGE_OVERRIDE_RULE = 'page-field-override-v1';

function normalizedJob(input: unknown): Job {
  const job = parseJob(input);
  if (job.kind !== 'diagnose' || job.trace === true) return job;
  return parseJob({ ...job, trace: true });
}

function jobForPlanKey(job: Job): JsonValue {
  if (job.kind !== 'capture' || job.interaction?.seed === undefined) return job as unknown as JsonValue;
  const { seed: _seed, ...interaction } = job.interaction;
  return { ...job, interaction } as unknown as JsonValue;
}

function requestShape(input: unknown): Shape | undefined {
  return input === undefined ? undefined : parseShape(input);
}

function overlayPage(base: Page | undefined, input: Page | undefined): Page | undefined {
  const inherited = base === undefined ? undefined : parsePage(base);
  if (input === undefined) return inherited;
  const override = parsePage(input);
  if (inherited === undefined) return override;
  const source = {
    kind: 'derived' as const,
    hash: digest({
      rule: PAGE_OVERRIDE_RULE,
      base: { id: inherited.id, hash: inherited.hash },
      override: { id: override.id, hash: override.hash },
    }),
    rule: PAGE_OVERRIDE_RULE,
  };
  const url = override.url ?? inherited.url;
  const html = override.html ?? inherited.html;
  const cookies = override.cookies ?? inherited.cookies;
  const connection = override.connection ?? inherited.connection;
  const clock = override.clock ?? inherited.clock;
  const performance = override.performance ?? inherited.performance;
  return parsePage(seal({
    schema: 2 as const,
    id: override.id,
    source,
    ...(url === undefined ? {} : { url }),
    ...(html === undefined ? {} : { html }),
    ...(cookies === undefined ? {} : { cookies }),
    ...(connection === undefined ? {} : { connection }),
    ...(clock === undefined ? {} : { clock }),
    ...(performance === undefined ? {} : { performance }),
  }));
}

export class Application extends RuntimeApplication {
  private readonly profiles: ProfilesPort;
  private readonly catalogs = new Map<string, Catalog>();
  private readonly plans = new Map<string, PlanCacheEntry>();

  constructor(options: ApplicationOptions) {
    super(options);
    this.profiles = options.profiles;
  }

  async plan(request: TaskRequest): Promise<Plan<Op, PlanBind>> {
    if (request === null || typeof request !== 'object') {
      throw new MimicError({ phase: 'parse', code: 'BAD_JOB', message: 'Task request must be an object' });
    }
    if (typeof request.profile !== 'string' || request.profile.length === 0) {
      throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: 'Task profile must be a non-empty id' });
    }
    const imported = await this.profiles.load(request.profile);
    const job = normalizedJob(request.job);
    const page = overlayPage(imported.page, request.page);
    const selected = requestShape(request.shape);
    const shapes = selected === undefined
      ? [imported.shape]
      : selected.id === imported.shape.id ? [selected] : [imported.shape, selected];
    const catalogKey = shapes.map((shape) => `${shape.id}@${shape.hash}`).join('|');
    const trustedShapes = shapes.every(isTrustedShape);
    let catalog = trustedShapes ? this.catalogs.get(catalogKey) : undefined;
    if (catalog) {
      this.catalogs.delete(catalogKey);
      this.catalogs.set(catalogKey, catalog);
    } else {
      catalog = Catalog.create('builtin', shapes, this.features);
      if (trustedShapes) {
        this.catalogs.set(catalogKey, catalog);
        this.trim(this.catalogs, CATALOG_CACHE_LIMIT);
      }
    }
    let normalizedRequire: SupportMap | undefined;
    try {
      normalizedRequire = checkSupport(request.require ?? {});
    } catch {
      // Invalid requests stay on the compiler path so they retain the BAD_PLAN contract.
    }
    const cacheable = trustedShapes
      && isTrustedProfile(imported.profile)
      && (page === undefined || isTrustedPage(page))
      && normalizedRequire !== undefined
      && (request.synthetic === undefined || typeof request.synthetic === 'boolean');
    const planKey = cacheable ? this.planKey({
      profile: imported.profile,
      shapes,
      job,
      require: normalizedRequire!,
      catalog: catalog.hash,
      ...(page === undefined ? {} : { page }),
      ...(request.synthetic === undefined ? {} : { synthetic: request.synthetic }),
    }) : undefined;
    const cached = planKey === undefined ? undefined : this.plans.get(planKey);
    if (cached && planKey !== undefined) {
      this.plans.delete(planKey);
      this.plans.set(planKey, cached);
      return cached.plan;
    }
    const plan = compile({
      profile: imported.profile,
      ...(page === undefined ? {} : { page }),
      job,
      catalog,
      engine: this.engine.manifest,
      drivers: Object.keys(this.drivers),
      ...(selected === undefined ? {} : { shape: { id: selected.id, hash: selected.hash } }),
      ...(request.require === undefined ? {} : { require: request.require }),
      ...(request.synthetic === undefined ? {} : { synthetic: request.synthetic }),
    });
    if (planKey !== undefined) {
      this.plans.set(planKey, { plan });
      this.trim(this.plans, PLAN_CACHE_LIMIT);
    }
    return plan;
  }

  private planKey(input: {
    profile: Profile;
    page?: Page;
    shapes: readonly Shape[];
    job: Job;
    require?: SupportMap;
    synthetic?: boolean;
    catalog: string;
  }): string {
    const body = {
      profile: { id: input.profile.id, hash: input.profile.hash },
      page: input.page === undefined ? null : { id: input.page.id, hash: input.page.hash },
      shapes: input.shapes.map((shape) => ({ id: shape.id, hash: shape.hash })),
      job: jobForPlanKey(input.job),
      require: input.require ?? {},
      synthetic: input.synthetic ?? null,
      catalog: input.catalog,
      engine: this.engine.manifest.hash,
    } as unknown as JsonValue;
    return createHash('sha256').update(canonical(body)).digest('hex');
  }

  private trim<K, V>(cache: Map<K, V>, limit: number): void {
    while (cache.size > limit) cache.delete(cache.keys().next().value!);
  }

  async execute(request: TaskRequest): Promise<Result> {
    let job: Job;
    let plan: Plan<Op, PlanBind>;
    try {
      job = normalizedJob(request.job);
      plan = await this.plan(request);
    } catch (cause) {
      return failure(cause);
    }
    return this.dispatch(job, plan);
  }

  async list(kind: ListKind): Promise<readonly string[]> {
    if (kind === 'profiles') return this.profiles.list();
    if (kind === 'features') return this.features.map((feature) => feature.id).sort();
    if (kind === 'drivers') return Object.keys(this.drivers).sort();
    if (kind === 'shapes') {
      const ids = new Set<string>();
      for (const profile of await this.profiles.list()) ids.add((await this.profiles.load(profile)).shape.id);
      return [...ids].sort();
    }
    throw new TypeError(`Unknown list kind:${String(kind)}`);
  }
}
