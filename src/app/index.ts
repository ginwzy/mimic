import { createHash } from 'node:crypto';
import { Catalog } from '../catalog/index.js';
import { compile } from '../compile/index.js';
import { canonical } from '../core/canonical.js';
import { MimicError } from '../core/error.js';
import { parseJob, parsePage, parseShape } from '../core/parse.js';
import { encodeResult } from '../core/result.js';
import { digest, seal } from '../core/seal.js';
import { isTrustedPage, isTrustedProfile, isTrustedShape } from '../core/trusted.js';
import type {
  Data,
  ErrorInfo,
  Job,
  JsonValue,
  Page,
  Plan,
  Profile,
  Result,
  Shape,
  SupportMap,
} from '../core/types.js';
import type { Drivers, Engine, Runtime } from '../engine/types.js';
import type { Feature, Op, PlanBind } from '../shape/types.js';
import { checkSupport } from '../shape/check.js';

export interface ProfileRecord {
  profile: Profile;
  page?: Page;
  shape: Shape;
}

export interface ProfilesPort {
  load(id: string): Promise<ProfileRecord>;
  list(): Promise<string[]>;
}

export interface CaptureOptions {
  deadlineMs?: number;
  pollMs?: number;
  maxPosts?: number;
  lifecycle?: CaptureLifecycle;
}

export type CaptureLifecycle = 'auto' | 'none';

export interface TaskRequest {
  profile: string;
  job: Job;
  page?: Page;
  shape?: Shape;
  require?: SupportMap;
  synthetic?: boolean;
}

export type ListKind = 'profiles' | 'shapes' | 'features' | 'drivers';

export interface ApplicationOptions {
  profiles: ProfilesPort;
  engine: Engine;
  features: readonly Feature[];
  drivers: Drivers;
  probe: string;
  capture?: CaptureOptions;
}

interface CaptureConfig {
  deadlineMs: number;
  pollMs: number;
  maxPosts: number;
  lifecycle: CaptureLifecycle;
}

interface PlanCacheEntry {
  plan: Plan<Op, PlanBind>;
}

const CATALOG_CACHE_LIMIT = 32;
const PLAN_CACHE_LIMIT = 128;
const PREPARED_EXECUTE = Symbol('mimic.executePrepared');
const PAGE_OVERRIDE_RULE = 'page-field-override-v1';

interface NetPost extends Data {
  via: string;
  tag: string;
  len: number;
  body: string | null;
}

interface NetReport extends Data {
  body: string | null;
  posts: NetPost[];
}

const LIFECYCLE = `(() => {
  const fire = (target, type, bubbles = false) => {
    try { target.dispatchEvent(new Event(type, { bubbles })); } catch {}
  };
  // jsdom often leaves readyState at "loading" after HTML inject; Chrome is "complete"
  // once load has fired. BMS / abck gate probes on readyState + hasFocus.
  try {
    if (document.readyState !== 'complete') {
      Object.defineProperty(document, 'readyState', {
        configurable: true, enumerable: true, get: () => 'complete',
      });
      fire(document, 'readystatechange');
      fire(document, 'DOMContentLoaded', true);
      fire(window, 'load');
    }
  } catch {}
  try {
    // Focused top-level browsing context (default for real page load).
    Document.prototype.hasFocus = function hasFocus() { return true; };
  } catch {}
  fire(window, 'pageshow');
})()`;

const WINDOW_PLACEHOLDER = '[unserializable: [object Window]]';

function positive(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function captureConfig(input: CaptureOptions = {}): CaptureConfig {
  const lifecycle = input.lifecycle ?? 'auto';
  if (lifecycle !== 'auto' && lifecycle !== 'none') {
    throw new TypeError('capture.lifecycle must be auto or none');
  }
  return Object.freeze({
    deadlineMs: positive(input.deadlineMs, 1_000, 'capture.deadlineMs'),
    pollMs: positive(input.pollMs, 10, 'capture.pollMs'),
    maxPosts: positive(input.maxPosts, 1, 'capture.maxPosts'),
    lifecycle,
  });
}

function normalizedJob(input: unknown): Job {
  const job = parseJob(input);
  if (job.kind !== 'diagnose' || job.trace === true) return job;
  return parseJob({ ...job, trace: true });
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

function errorInfo(cause: unknown, plan?: string): ErrorInfo {
  if (cause instanceof MimicError) {
    return {
      name: 'MimicError',
      phase: cause.phase,
      code: cause.code,
      message: cause.message,
      ...(cause.details === undefined ? {} : { details: cause.details }),
      ...(cause.plan === undefined && plan === undefined ? {} : { plan: cause.plan ?? plan! }),
    };
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return { name: 'MimicError', phase: 'run', code: 'RUN_FAILED', message, ...(plan ? { plan } : {}) };
}

function failure(cause: unknown, plan?: Plan<Op, PlanBind>, report?: Data): Result {
  const error = errorInfo(cause, plan?.id);
  return encodeResult({
    ok: false,
    error,
    ...(report === undefined ? {} : { report }),
    ...(plan === undefined ? {} : {
      plan: plan.id,
      support: plan.support,
      ...(plan.synthetic === true ? { synthetic: true as const } : {}),
    }),
  });
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function missingFrom(cause: unknown): string[] {
  const match = causeMessage(cause).match(/\b([A-Za-z_$][\w$]*) is not defined\b/);
  return match?.[1] === undefined ? [] : [match[1]];
}

function traceFailure(report: Data, cause: unknown): Data {
  const inferred = missingFrom(cause);
  if (inferred.length === 0) return report;
  const raw = report.trace;
  const trace = raw !== null && !Array.isArray(raw) && typeof raw === 'object' ? raw as Data : {};
  const known = Array.isArray(trace.missing)
    ? trace.missing.filter((value): value is string => typeof value === 'string')
    : [];
  return {
    ...report,
    trace: { ...trace, missing: [...new Set([...known, ...inferred])] },
  };
}

function compatibleValue(runtime: Runtime, value: unknown): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value;
  const identity = runtime.run('window');
  return identity.ok && identity.value === value ? WINDOW_PLACEHOLDER : value;
}

function net(report: Data): NetReport {
  const value = report.net;
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return { body: null, posts: [] };
  }
  const data = value as Data;
  const posts = Array.isArray(data.posts) ? data.posts.filter((item): item is NetPost => (
    item !== null && !Array.isArray(item) && typeof item === 'object'
      && typeof item.via === 'string' && typeof item.tag === 'string'
      && typeof item.len === 'number' && (typeof item.body === 'string' || item.body === null)
  )) : [];
  return {
    body: typeof data.body === 'string' ? data.body : null,
    posts: posts.map((post) => ({ ...post })),
  };
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class Application {
  readonly engine: Engine;
  private readonly profiles: ProfilesPort;
  private readonly features: readonly Feature[];
  private readonly drivers: Drivers;
  private readonly probe: string;
  private readonly capture: CaptureConfig;
  private readonly catalogs = new Map<string, Catalog>();
  private readonly plans = new Map<string, PlanCacheEntry>();

  constructor(options: ApplicationOptions) {
    this.profiles = options.profiles;
    this.engine = options.engine;
    this.features = Object.freeze([...options.features]);
    this.drivers = Object.freeze({ ...options.drivers });
    this.probe = options.probe;
    this.capture = captureConfig(options.capture);
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
      job: input.job,
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

  execute(request: TaskRequest): Promise<Result> {
    return this.executeTask(request);
  }

  [PREPARED_EXECUTE](request: TaskRequest, prepared: Plan<Op, PlanBind>): Promise<Result> {
    return this.executeTask(request, prepared);
  }

  private async executeTask(request: TaskRequest, prepared?: Plan<Op, PlanBind>): Promise<Result> {
    let plan: Plan<Op, PlanBind>;
    let job: Job;
    try {
      job = normalizedJob(request.job);
      plan = prepared ?? await this.plan(request);
    } catch (cause) {
      return failure(cause);
    }

    let runtime: Runtime;
    try {
      runtime = this.engine.open(plan, this.drivers);
    } catch (cause) {
      return failure(cause, plan);
    }

    let result: Result;
    try {
      result = await this.run(runtime, plan, job);
    } catch (cause) {
      let report: Data | undefined;
      try { report = runtime.report(); } catch { /* cleanup path */ }
      if (report !== undefined && (job.kind === 'diagnose' || ('trace' in job && job.trace === true))) {
        report = traceFailure(report, cause);
      }
      result = failure(cause, plan, report);
    }

    try {
      runtime.dispose();
    } catch (cause) {
      if (result.ok) result = failure(cause, plan, result.report);
    }
    return result;
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

  private async run(runtime: Runtime, plan: Plan<Op, PlanBind>, job: Job): Promise<Result> {
    let value: unknown;
    let report: Data | undefined;
    if (job.kind === 'probe') {
      if (!this.probe) throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: 'Probe source is unavailable', plan: plan.id });
      const executed = runtime.run(
        `${this.probe}\n;window.__probe__();`,
        job.timeout === undefined ? {} : { timeout: job.timeout },
      );
      if (!executed.ok) throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: executed.error, plan: plan.id });
      value = compatibleValue(runtime, executed.value);
      report = runtime.report();
    } else {
      const runOptions = {
        ...(job.timeout === undefined ? {} : { timeout: job.timeout }),
        ...(job.scriptUrl === undefined ? {} : { url: job.scriptUrl }),
      };
      // Capture: complete document lifecycle BEFORE page scripts so BMS/abck see
      // readyState=complete and hasFocus=true (was run after job — silent probe fails).
      if (job.kind === 'capture' && this.capture.lifecycle === 'auto') {
        const lifecycle = runtime.run(LIFECYCLE, job.timeout === undefined ? {} : { timeout: job.timeout });
        if (!lifecycle.ok) throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: lifecycle.error, plan: plan.id });
      }
      const executed = runtime.run(job.code, runOptions);
      if (!executed.ok) throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: executed.error, plan: plan.id });
      value = compatibleValue(runtime, executed.value);
      if (job.kind === 'capture') {
        const before = net(runtime.report());
        await delay(0);
        const started = Date.now();
        let current = net(runtime.report());
        while (Date.now() - started < this.capture.deadlineMs
          && current.posts.filter((post) => post.len > 0).length < this.capture.maxPosts) {
          await delay(this.capture.pollMs);
          current = net(runtime.report());
        }
        report = runtime.report();
        value = {
          syncCaptured: before.posts.some((post) => post.len > 0),
          captured: current.body,
          posts: current.posts,
        };
      } else if (job.kind === 'diagnose' || job.trace === true) {
        report = runtime.report();
      }
    }

    return encodeResult({
      ok: true,
      ...(value === undefined ? {} : { value }),
      ...(report === undefined ? {} : { report }),
      plan: plan.id,
      support: plan.support,
      ...(plan.synthetic === true ? { synthetic: true as const } : {}),
    });
  }
}

export function executePrepared(
  application: Application,
  request: TaskRequest,
  plan: Plan<Op, PlanBind>,
): Promise<Result> {
  return application[PREPARED_EXECUTE](request, plan);
}
