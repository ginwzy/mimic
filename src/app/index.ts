import type { Plan, Result } from '../core/types.js';
import type { Engine } from '../engine/types.js';
import { failure, TaskRunner } from '../runtime/runner.js';
import type { Op, PlanBind } from '../shape/types.js';
import { normalizedJob } from '../core/job.js';
import { Planner } from './planner.js';
import type { Compilation } from '../compile/index.js';
import type { CapabilityRequirements } from '../core/capabilities.js';
import type { ApplicationOptions, ListKind, TaskRequest } from './types.js';

export type {
  ApplicationOptions, CaptureLifecycle, CaptureOptions, ListKind, ProfileRecord,
  ProfilesPort, RuntimeOptions, TaskRequest,
} from './types.js';

/** Advanced in-process facade; planning and execution have independent owners. */
export class Application {
  readonly engine: Engine;
  private readonly planner: Planner;
  private readonly runner: TaskRunner;

  constructor(options: ApplicationOptions) {
    this.engine = options.engine;
    this.planner = new Planner({
      profiles: options.profiles,
      features: options.features,
      drivers: Object.keys(options.drivers),
      engine: options.engine.manifest,
    });
    this.runner = new TaskRunner(options);
  }

  plan(request: TaskRequest): Promise<Plan<Op, PlanBind>> {
    return this.planner.plan(request);
  }

  list(kind: ListKind): Promise<readonly string[]> {
    return this.planner.list(kind);
  }

  inspect(request: TaskRequest, requirements?: CapabilityRequirements): Promise<Compilation> {
    return this.planner.inspect(request, requirements);
  }

  async execute(request: TaskRequest): Promise<Result> {
    try {
      const job = normalizedJob(request.job);
      const plan = await this.planner.plan(request);
      return this.runner.execute(job, plan);
    } catch (cause) {
      return failure(cause);
    }
  }

  executePrepared(request: TaskRequest, plan: Plan<Op, PlanBind>): Promise<Result> {
    return this.runner.execute(request.job, plan);
  }
}
