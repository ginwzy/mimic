import { MimicError } from '../core/error.js';
import { encodeResult } from '../core/result.js';
import type { Data, ErrorInfo, Job, Plan, Result } from '../core/types.js';
import type { Drivers, Engine, Runtime } from '../engine/types.js';
import { createInteractionSource } from '../interaction/dispatch.js';
import { createInteractionPolicy } from '../interaction/policies.js';
import { createInteractionSession, synthesizeInteraction } from '../interaction/synthesize.js';
import type { Feature, Op, PlanBind } from '../shape/types.js';
import type { CaptureOptions, RuntimeOptions, TaskRequest } from './types.js';

interface CaptureConfig {
  deadlineMs: number;
  pollMs: number;
  maxPosts: number;
  lifecycle: NonNullable<CaptureOptions['lifecycle']>;
}

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

export function failure(cause: unknown, plan?: Plan<Op, PlanBind>, report?: Data): Result {
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

/** Execute-only host. Workers must import this, not `app/index.ts`. */
export class RuntimeApplication {
  readonly engine: Engine;
  protected readonly features: readonly Feature[];
  protected readonly drivers: Drivers;
  private readonly probe: string;
  private readonly capture: CaptureConfig;

  constructor(options: RuntimeOptions) {
    this.engine = options.engine;
    this.features = Object.freeze([...options.features]);
    this.drivers = Object.freeze({ ...options.drivers });
    this.probe = options.probe;
    this.capture = captureConfig(options.capture);
  }

  executePrepared(request: TaskRequest, plan: Plan<Op, PlanBind>): Promise<Result> {
    return this.dispatch(request.job, plan);
  }

  protected async dispatch(job: Job, plan: Plan<Op, PlanBind>): Promise<Result> {
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
        const adapter = job.interaction?.adapter ?? 'none';
        const policy = createInteractionPolicy(adapter);
        const interactionSeed = `${plan.id}\u0000${adapter}\u0000${job.interaction?.seed ?? ''}`;
        const interactionSession = createInteractionSession(interactionSeed);
        let interactionSequence = 0;
        while (Date.now() - started < this.capture.deadlineMs
          && current.posts.filter((post) => post.len > 0).length < this.capture.maxPosts) {
          const elapsed = Date.now() - started;
          const postCount = current.posts.filter((post) => post.len > 0).length;
          const recipe = policy(elapsed, postCount);
          if (recipe !== null) {
            const frames = synthesizeInteraction(recipe, interactionSession, interactionSequence++, elapsed);
            const dispatchResult = runtime.run(
              createInteractionSource(frames),
              { ...(job.timeout === undefined ? {} : { timeout: job.timeout }), trustedEvents: true },
            );
            if (!dispatchResult.ok) {
              throw new MimicError({
                phase: 'run',
                code: 'RUN_FAILED',
                message: `Interaction dispatch failed:${dispatchResult.error}`,
                plan: plan.id,
              });
            }
          }
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
