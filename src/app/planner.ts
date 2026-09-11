import { createHash } from 'node:crypto';
import { Catalog } from '../catalog/index.js';
import { compileWithCapabilities, type Compilation } from '../compile/index.js';
import { assertCapabilities, type CapabilityRequirements } from '../core/capabilities.js';
import { canonical } from '../core/canonical.js';
import { MimicError } from '../core/error.js';
import { parsePage, parseShape } from '../core/parse.js';
import { digest, seal } from '../core/seal.js';
import { isTrustedPage, isTrustedProfile, isTrustedShape } from '../core/trusted.js';
import type {
  Job,
  JsonValue,
  Page,
  Plan,
  Profile,
  Shape,
  SupportMap,
} from '../core/types.js';
import type { EngineManifest, Feature, Op, PlanBind } from '../shape/types.js';
import { checkSupport } from '../shape/check.js';
import { normalizedJob } from '../core/job.js';
import type { ListKind, PlannerOptions, PlannerPort, ProfilesPort, TaskRequest } from './types.js';

const CATALOG_CACHE_LIMIT = 32;
const PLAN_CACHE_LIMIT = 128;
const PAGE_OVERRIDE_RULE = 'page-field-override-v1';

function jobForPlanKey(job: Job, features: readonly Feature[]): JsonValue {
  if (features.some(feature => feature.jobKeys === undefined)) return job as unknown as JsonValue;
  // The compiler always writes job.kind to Plan.task, independently of Features.
  const keys = new Set(['kind', ...features.flatMap(feature => feature.jobKeys!)]);
  return Object.fromEntries(Object.entries(job).filter(([key]) => keys.has(key))) as JsonValue;
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
  if (inherited.layout && !override.layout && (html !== inherited.html || url !== inherited.url)) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PAGE', message: 'Page HTML/URL override requires a new layout snapshot' });
  }
  const layout = override.layout ?? inherited.layout;
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
    ...(layout === undefined ? {} : { layout }),
    ...(cookies === undefined ? {} : { cookies }),
    ...(connection === undefined ? {} : { connection }),
    ...(clock === undefined ? {} : { clock }),
    ...(performance === undefined ? {} : { performance }),
  }));
}

export class Planner implements PlannerPort {
  private readonly profiles: ProfilesPort;
  private readonly features: readonly Feature[];
  private readonly drivers: readonly string[];
  private readonly engine: EngineManifest;
  private readonly catalogs = new Map<string, Catalog>();
  private readonly plans = new Map<string, Compilation>();

  constructor(options: PlannerOptions) {
    this.profiles = options.profiles;
    this.features = Object.freeze([...options.features]);
    this.drivers = Object.freeze([...options.drivers]);
    this.engine = options.engine;
  }

  async plan(request: TaskRequest): Promise<Plan<Op, PlanBind>> {
    return (await this.inspect(request)).plan;
  }

  async inspect(request: TaskRequest, requirements?: CapabilityRequirements): Promise<Compilation> {
    const compiled = await this.prepare(request);
    if (requirements !== undefined) assertCapabilities(compiled.capabilities, requirements);
    return compiled;
  }

  private async prepare(request: TaskRequest): Promise<Compilation> {
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
      job: jobForPlanKey(job, catalog.resolve(selected ?? imported.profile.shape).features),
      require: normalizedRequire!,
      catalog: catalog.hash,
      ...(page === undefined ? {} : { page }),
      ...(request.synthetic === undefined ? {} : { synthetic: request.synthetic }),
    }) : undefined;
    const cached = planKey === undefined ? undefined : this.plans.get(planKey);
    if (cached && planKey !== undefined) {
      this.plans.delete(planKey);
      this.plans.set(planKey, cached);
      return cached;
    }
    const compiled = compileWithCapabilities({
      profile: imported.profile,
      ...(page === undefined ? {} : { page }),
      job,
      catalog,
      engine: this.engine,
      drivers: this.drivers,
      ...(selected === undefined ? {} : { shape: { id: selected.id, hash: selected.hash } }),
      ...(request.require === undefined ? {} : { require: request.require }),
      ...(request.synthetic === undefined ? {} : { synthetic: request.synthetic }),
    });
    if (planKey !== undefined) {
      this.plans.set(planKey, compiled);
      this.trim(this.plans, PLAN_CACHE_LIMIT);
    }
    return compiled;
  }

  private planKey(input: {
    profile: Profile;
    page?: Page;
    shapes: readonly Shape[];
    job: JsonValue;
    require?: SupportMap;
    synthetic?: boolean;
    catalog: string;
  }): string {
    const body = {
      profile: { id: input.profile.id, hash: input.profile.hash },
      page: input.page === undefined ? null : { id: input.page.id, hash: input.page.hash },
      shapes: input.shapes.map((shape) => ({ id: shape.id, hash: shape.hash })),
      job: input.job,
      require: input.require ?? {},
      synthetic: input.synthetic ?? null,
      catalog: input.catalog,
      engine: this.engine.hash,
    } as unknown as JsonValue;
    return createHash('sha256').update(canonical(body)).digest('hex');
  }

  private trim<K, V>(cache: Map<K, V>, limit: number): void {
    while (cache.size > limit) cache.delete(cache.keys().next().value!);
  }

  async list(kind: ListKind): Promise<readonly string[]> {
    if (kind === 'profiles') return this.profiles.list();
    if (kind === 'features') return this.features.map((feature) => feature.id).sort();
    if (kind === 'drivers') return [...this.drivers].sort();
    if (kind === 'shapes') {
      const ids = new Set<string>();
      for (const profile of await this.profiles.list()) ids.add((await this.profiles.load(profile)).shape.id);
      return [...ids].sort();
    }
    throw new TypeError(`Unknown list kind:${String(kind)}`);
  }
}
