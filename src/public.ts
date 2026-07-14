import { MimicError } from './core/error.js';
import type { Job, Plan, Result } from './core/types.js';
import type { Op, PlanBind } from './shape/types.js';
import { createMimic as createInternal, type MimicOptions } from './sdk.js';

export { MimicError };
export type {
  ErrorInfo,
  Hash,
  Page,
  PagePerformance,
  Plan,
  Profile,
  PerformanceResource,
  Result,
  Shape,
  Support,
  SupportMap,
  Target,
} from './core/types.js';

type ScriptJob = Extract<Job, { code: string }>;
export type RunJob = Omit<ScriptJob, 'kind'> & { kind: 'run' };
export type CaptureJob = Omit<ScriptJob, 'kind'> & { kind: 'capture' };
export type PlanJob = RunJob | CaptureJob;
export type ListKind = 'profiles' | 'shapes' | 'features' | 'drivers';
export type MimicClientOptions = MimicOptions;

export interface MimicClient {
  run(job: RunJob): Promise<Result>;
  capture(job: CaptureJob): Promise<Result>;
  plan(job: PlanJob): Promise<Plan<Op, PlanBind>>;
  list(kind: ListKind): Promise<readonly string[]>;
  close(): Promise<void>;
}

export function createMimic(options: MimicClientOptions = {}): MimicClient {
  const mimic = createInternal(options);
  return Object.freeze({
    run: mimic.run.bind(mimic),
    capture: mimic.capture.bind(mimic),
    plan: mimic.plan.bind(mimic),
    list: mimic.list.bind(mimic),
    close: mimic.close.bind(mimic),
  });
}
