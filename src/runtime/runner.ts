import { MimicError } from '../core/error.js';
import { encodeResult } from '../core/result.js';
import type { Data, ErrorInfo, Job, Plan, Result } from '../core/types.js';
import type { Drivers, Engine, Runtime } from '../engine/types.js';
import type { Op, PlanBind } from '../shape/types.js';
import type { RuntimeOptions } from '../app/types.js';
import { CaptureSession } from './capture.js';
import { executeScript } from './script.js';
import { prepareExecution, type PreparedExecution } from './task.js';
import { captureConfig, type CaptureConfig } from './options.js';

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

/** Runs an already compiled task without loading profiles or compiling Features. */
export class TaskRunner {
  readonly engine: Engine;
  private readonly drivers: Drivers;
  private readonly probe: string;
  private readonly capture: CaptureConfig;

  constructor(options: RuntimeOptions) {
    this.engine = options.engine;
    this.drivers = Object.freeze({ ...options.drivers });
    this.probe = options.probe;
    this.capture = captureConfig(options.capture);
  }

  async execute(job: Job, plan: Plan<Op, PlanBind>): Promise<Result> {
    try {
      return await this.executePrepared(prepareExecution(job, plan, this.capture));
    } catch (cause) {
      return failure(cause, plan);
    }
  }

  async executePrepared(task: PreparedExecution): Promise<Result> {
    const { plan, job } = task;
    let runtime: Runtime;
    try {
      runtime = this.engine.open(plan, this.drivers);
    } catch (cause) {
      return failure(cause, plan);
    }

    let result: Result;
    try {
      result = await this.run(runtime, task);
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

  private async run(runtime: Runtime, task: PreparedExecution): Promise<Result> {
    const { job, plan, policy } = task;
    let value: unknown;
    let report: Data | undefined;
    if (job.kind === 'capture') {
      if (!policy.capture) throw new TypeError('Capture policy is unavailable');
      ({ value, report } = await new CaptureSession(runtime, policy.capture, policy.script).run(job.code));
    } else {
      if (job.kind === 'probe' && !this.probe) {
        throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: 'Probe source is unavailable', plan: plan.id });
      }
      const code = job.kind === 'probe' ? `${this.probe}\n;window.__probe__();` : job.code;
      value = executeScript(runtime, code, policy.script);
      if (job.kind === 'probe' || job.kind === 'diagnose' || job.trace === true) report = runtime.report();
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
