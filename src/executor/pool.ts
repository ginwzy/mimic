import path from 'node:path';
import type { CaptureOptions, PlannerPort, TaskRequest } from '../app/types.js';
import type { Result } from '../core/types.js';
import { DEFAULT_PROBE_PATH } from '../node/assets.js';
import { createNodePlanner } from '../node/planner.js';
import { captureConfig } from '../runtime/options.js';
import { WorkerPool, type ExecutorStats, type WorkerLifecycle } from './worker-pool.js';

export { DEFAULT_MAX_QUEUE, DEFAULT_TIMEOUT_MS, QueueFullError } from './worker-pool.js';
export type { ExecutorStats, WorkerLifecycle } from './worker-pool.js';
export type { WorkerConfig } from './protocol.js';

export interface ExecutorOptions {
  profilesRoot?: string;
  shapesRoot?: string;
  probePath?: string;
  capture?: CaptureOptions;
  planner?: PlannerPort;
  size?: number;
  timeoutMs?: number | null;
  maxQueue?: number;
}

/** Published Node convenience facade; WorkerPool only receives dependencies. */
export class WorkerExecutor {
  private readonly pool: WorkerPool;

  constructor(options: ExecutorOptions = {}) {
    this.pool = new WorkerPool({
      ...options,
      planner: options.planner ?? createNodePlanner(options),
      worker: {
        probePath: path.resolve(options.probePath ?? DEFAULT_PROBE_PATH),
        capture: captureConfig(options.capture),
      },
    });
  }

  get size(): number { return this.pool.size; }
  get timeoutMs(): number | null { return this.pool.timeoutMs; }
  get maxQueue(): number { return this.pool.maxQueue; }
  get active(): number { return this.pool.active; }
  get queued(): number { return this.pool.queued; }
  get stats(): ExecutorStats { return this.pool.stats; }
  get workerLifecycle(): WorkerLifecycle { return this.pool.workerLifecycle; }

  run(request: TaskRequest): Promise<Result> { return this.pool.run(request); }
  destroy(): Promise<void> { return this.pool.destroy(); }
}
