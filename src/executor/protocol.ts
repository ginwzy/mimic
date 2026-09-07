import type { CaptureOptions } from '../app/types.js';
import type { Job, Plan } from '../core/types.js';
import type { Op, PlanBind } from '../shape/types.js';
import type { ExecutionPolicy } from '../runtime/task.js';
import type { NetworkChannel } from '../network/types.js';

export const WORKER_PLAN_CACHE_LIMIT = 128;

export interface WorkerConfig {
  probePath: string;
  capture?: CaptureOptions;
}

export interface ExecuteMessage {
  id: number;
  job: Job;
  policy: ExecutionPolicy;
  planId: string;
  plan?: Plan<Op, PlanBind>;
  network?: NetworkChannel;
}

export type WorkerMessage =
  | { id: number; started: true; result?: never }
  | { id: number; result: unknown; started?: never };
