import type { ListKind, TaskRequest } from './app/index.js';
import { parseJob } from './core/job.js';
import { parseCaptureResult, type CaptureResult } from './core/capture.js';
import type { Job, Page, Plan, Result, Shape, SupportMap } from './core/types.js';
import { WorkerExecutor, type ExecutorOptions } from './executor/pool.js';
import { createNodePlanner } from './node/planner.js';
import type { Op, PlanBind } from './shape/types.js';

export interface MimicOptions extends Omit<ExecutorOptions, 'planner'> {
  profile?: string;
  page?: Page;
  shape?: Shape;
  require?: SupportMap;
  synthetic?: boolean;
}

function kind(input: unknown, expected: Job['kind']): Job {
  const job = parseJob(input);
  if (job.kind !== expected) throw new TypeError(`${expected} requires a ${expected} Job`);
  return job;
}

export class Mimic {
  readonly executor: WorkerExecutor;
  private readonly planner: ReturnType<typeof createNodePlanner>;
  private readonly context: Omit<TaskRequest, 'job'>;

  constructor(options: MimicOptions = {}) {
    this.context = {
      profile: options.profile ?? '',
      ...(options.page === undefined ? {} : { page: structuredClone(options.page) }),
      ...(options.shape === undefined ? {} : { shape: structuredClone(options.shape) }),
      ...(options.require === undefined ? {} : { require: structuredClone(options.require) }),
      ...(options.synthetic === undefined ? {} : { synthetic: options.synthetic }),
    };
    this.planner = createNodePlanner({
      ...(options.profilesRoot === undefined ? {} : { profilesRoot: options.profilesRoot }),
      ...(options.shapesRoot === undefined ? {} : { shapesRoot: options.shapesRoot }),
    });
    this.executor = new WorkerExecutor({ ...options, planner: this.planner });
  }

  async run(job: Job): Promise<Result> {
    return this.execute(kind(job, 'run'));
  }

  async capture(job: Job): Promise<CaptureResult> {
    return parseCaptureResult(await this.execute(kind(job, 'capture')));
  }

  async probe(job: Job): Promise<Result> {
    return this.execute(kind(job, 'probe'));
  }

  async diagnose(job: Job): Promise<Result> {
    return this.execute(kind(job, 'diagnose'));
  }

  async plan(job: Job): Promise<Plan<Op, PlanBind>> {
    return this.planner.plan(this.request(parseJob(job)));
  }

  async list(kindName: ListKind): Promise<readonly string[]> {
    return this.planner.list(kindName);
  }

  close(): Promise<void> {
    return this.executor.destroy();
  }

  private execute(job: Job): Promise<Result> {
    return this.executor.run(this.request(job));
  }

  private request(job: Job): TaskRequest {
    if (!this.context.profile.trim()) {
      throw new TypeError('profile is required; use list("profiles") to select a local fp-env ID');
    }
    return structuredClone({ ...this.context, job });
  }
}

export function createMimic(options: MimicOptions = {}): Mimic {
  return new Mimic(options);
}
