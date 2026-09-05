import { normalizedJob } from '../core/job.js';
import type { CaptureOptions } from '../app/types.js';
import { deepFreeze } from '../core/json.js';
import type { InteractionAdapter, Job, Plan } from '../core/types.js';
import type { Op, PlanBind } from '../shape/types.js';
import { captureConfig, type CaptureConfig } from './options.js';

export interface ScriptPolicy {
  readonly timeoutMs: number | null;
  /** null leaves currentScript unset and uses the Runtime's default filename. */
  readonly url: string | null;
}

export interface CapturePolicy extends CaptureConfig {
  readonly clock: 'after-script-yield';
  readonly interaction: { readonly adapter: InteractionAdapter; readonly seed: string };
  readonly completion: { readonly minimumInteractionMs: number; readonly quietMs: number };
}

export interface ExecutionPolicy {
  readonly revision: 'execution-v1';
  readonly script: ScriptPolicy;
  readonly capture: CapturePolicy | null;
}

/** Plan identifies installation only; Job and effective policy travel with each execution. */
export interface PreparedExecution {
  readonly plan: Plan<Op, PlanBind>;
  readonly job: Job;
  readonly policy: ExecutionPolicy;
}

export function prepareExecution(input: Job, plan: Plan<Op, PlanBind>, capture?: CaptureOptions): PreparedExecution {
  const job = normalizedJob(input);
  const adapter = job.kind === 'capture' ? job.interaction?.adapter ?? 'none' : 'none';
  const policy: ExecutionPolicy = deepFreeze({
    revision: 'execution-v1',
    script: {
      timeoutMs: job.timeout ?? null,
      url: 'scriptUrl' in job ? job.scriptUrl ?? null : null,
    },
    capture: job.kind === 'capture' ? {
      ...captureConfig(capture),
      clock: 'after-script-yield',
      interaction: { adapter, seed: `${plan.id}\u0000${adapter}\u0000${job.interaction?.seed ?? ''}` },
      completion: { minimumInteractionMs: 5_000, quietMs: 500 },
    } : null,
  });
  return Object.freeze({ plan, job, policy });
}
