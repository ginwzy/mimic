import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import type { CaptureOptions, TaskRequest } from '../app/index.js';
import { MimicError } from '../core/error.js';
import { parseResult } from '../core/result.js';
import type { Plan, Result } from '../core/types.js';
import { DEFAULT_PROBE_PATH, DEFAULT_PROFILES_ROOT, DEFAULT_SHAPES_ROOT } from '../node/assets.js';
import { createNodeApplication } from '../node/app.js';
import type { Op, PlanBind } from '../shape/types.js';

const WORKER_URL = new URL('./worker.js', import.meta.url);
const WORKER_PLAN_CACHE_LIMIT = 128;
export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_QUEUE = 100;

export interface ExecutorOptions {
  profilesRoot?: string;
  shapesRoot?: string;
  probePath?: string;
  capture?: CaptureOptions;
  size?: number;
  timeoutMs?: number | null;
  maxQueue?: number;
}

export interface ExecutorStats {
  size: number;
  active: number;
  idle: number;
  queued: number;
  maxQueue: number;
}

export interface WorkerLifecycle {
  created: number;
  terminated: number;
  live: number;
}

export interface WorkerConfig {
  profilesRoot: string;
  shapesRoot: string;
  probePath: string;
  capture?: CaptureOptions;
}

interface Pending {
  resolve: (result: Result) => void;
  reject: (error: unknown) => void;
}

interface Queued {
  id: number;
  request: TaskRequest;
  timeoutMs: number | null;
}

interface Slot {
  worker: Worker;
  id: number | null;
  timeoutMs: number | null;
  watchdog: NodeJS.Timeout | null;
  down: boolean;
  plans: Map<string, true>;
}

interface WorkerMessage {
  id: number;
  started?: true;
  result?: unknown;
}

function timeout(value: number | null | undefined, fallback: number | null, name: string): number | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer or null`);
  return value;
}

function maxQueue(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_QUEUE;
  if (!Number.isInteger(value) || value < 0) throw new RangeError('maxQueue must be a non-negative integer');
  return value;
}

function poolSize(value: number | undefined): number {
  if (value === undefined) return Math.max(1, Math.min(4, os.cpus().length - 1));
  if (!Number.isInteger(value) || value <= 0) throw new RangeError('size must be a positive integer');
  return value;
}

function timeoutResult(milliseconds: number): Result {
  return parseResult({
    ok: false,
    error: {
      name: 'MimicError',
      phase: 'run',
      code: 'RUN_FAILED',
      message: `Task execution timed out after ${milliseconds}ms`,
    },
  });
}

function workerFailure(error: unknown): Result {
  const message = error instanceof Error ? error.message : String(error);
  return parseResult({
    ok: false,
    error: { name: 'MimicError', phase: 'run', code: 'RUN_FAILED', message },
  });
}

function planningFailure(error: unknown): Result {
  if (error instanceof MimicError) {
    return parseResult({ ok: false, error: error.toJSON() });
  }
  return workerFailure(error);
}

export class QueueFullError extends Error {
  readonly code = 'ERR_MIMIC_QUEUE_FULL';

  constructor(limit: number) {
    super(`WorkerExecutor queue is full (maxQueue=${limit})`);
    this.name = 'QueueFullError';
  }
}

export class WorkerExecutor {
  readonly size: number;
  readonly timeoutMs: number | null;
  readonly maxQueue: number;
  private readonly config: WorkerConfig;
  private readonly planner: ReturnType<typeof createNodeApplication>;
  private readonly workers: Slot[] = [];
  private readonly idle: Slot[] = [];
  private readonly queue: Queued[] = [];
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private createdWorkers = 0;
  private terminatedWorkers = 0;
  private readonly retiring = new Set<Promise<void>>();
  private destroyed = false;
  private destroyPromise: Promise<void> | null = null;

  constructor(options: ExecutorOptions = {}) {
    this.size = poolSize(options.size);
    this.timeoutMs = timeout(options.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');
    this.maxQueue = maxQueue(options.maxQueue);
    this.config = {
      profilesRoot: path.resolve(options.profilesRoot ?? DEFAULT_PROFILES_ROOT),
      shapesRoot: path.resolve(options.shapesRoot ?? DEFAULT_SHAPES_ROOT),
      probePath: path.resolve(options.probePath ?? DEFAULT_PROBE_PATH),
      ...(options.capture === undefined ? {} : { capture: structuredClone(options.capture) }),
    };
    this.planner = createNodeApplication(this.config);
    this.spawn();
  }

  get active(): number {
    return this.workers.reduce((count, slot) => count + (slot.id === null ? 0 : 1), 0);
  }

  get queued(): number {
    return this.queue.length;
  }

  get stats(): ExecutorStats {
    return {
      size: this.size,
      active: this.active,
      idle: this.idle.length,
      queued: this.queue.length,
      maxQueue: this.maxQueue,
    };
  }

  get workerLifecycle(): WorkerLifecycle {
    return {
      created: this.createdWorkers,
      terminated: this.terminatedWorkers,
      live: this.createdWorkers - this.terminatedWorkers,
    };
  }

  run(request: TaskRequest): Promise<Result> {
    if (this.destroyed) return Promise.reject(new Error('WorkerExecutor is destroyed'));
    let clean: TaskRequest;
    try {
      clean = structuredClone(request);
    } catch (cause) {
      return Promise.reject(new TypeError(`Task request is not clone-safe: ${cause instanceof Error ? cause.message : String(cause)}`));
    }
    if (this.idle.length === 0 && this.workers.length >= this.size && this.queue.length >= this.maxQueue) {
      return Promise.reject(new QueueFullError(this.maxQueue));
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.queue.push({ id, request: clean, timeoutMs: this.timeoutMs });
      this.drain();
    });
  }

  destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyed = true;
    const error = new Error('WorkerExecutor is destroyed');
    for (const item of this.pending.values()) item.reject(error);
    this.pending.clear();
    this.queue.length = 0;
    this.idle.length = 0;
    const slots = this.workers.splice(0);
    for (const slot of slots) {
      slot.down = true;
      this.clearWatchdog(slot);
      this.retire(slot.worker);
    }
    this.destroyPromise = Promise.all([...this.retiring]).then(() => undefined);
    return this.destroyPromise;
  }

  private spawn(): void {
    if (this.destroyed || this.workers.length >= this.size) return;
    const worker = new Worker(WORKER_URL, { workerData: this.config, execArgv: [] });
    this.createdWorkers++;
    const slot: Slot = { worker, id: null, timeoutMs: null, watchdog: null, down: false, plans: new Map() };
    worker.on('message', (message: WorkerMessage) => this.message(slot, message));
    worker.on('error', (error) => this.workerDown(slot, error));
    worker.on('exit', (code) => this.workerDown(slot, new Error(`worker exited with code ${code}`)));
    this.workers.push(slot);
    this.idle.push(slot);
  }

  private message(slot: Slot, message: WorkerMessage): void {
    if (slot.down || this.destroyed || message.id !== slot.id) return;
    if (message.started) {
      this.armWatchdog(slot);
      return;
    }
    if (message.result === undefined) return this.workerDown(slot, new Error('worker returned no Result'));
    let result: Result;
    try {
      result = parseResult(message.result);
    } catch (cause) {
      return this.workerDown(slot, cause);
    }
    this.clearWatchdog(slot);
    const pending = this.pending.get(message.id);
    if (pending) {
      this.pending.delete(message.id);
      pending.resolve(result);
    }
    slot.id = null;
    slot.timeoutMs = null;
    if (!this.destroyed) {
      this.idle.push(slot);
      this.drain();
    }
  }

  private armWatchdog(slot: Slot): void {
    this.clearWatchdog(slot);
    if (slot.timeoutMs === null) return;
    const milliseconds = slot.timeoutMs;
    slot.watchdog = setTimeout(() => {
      if (this.destroyed || slot.down || slot.id === null) return;
      const id = slot.id;
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        pending.resolve(timeoutResult(milliseconds));
      }
      this.replace(slot);
    }, milliseconds);
  }

  private clearWatchdog(slot: Slot): void {
    if (slot.watchdog !== null) clearTimeout(slot.watchdog);
    slot.watchdog = null;
  }

  private workerDown(slot: Slot, error: unknown): void {
    if (this.destroyed || slot.down) return;
    if (slot.id !== null) {
      const pending = this.pending.get(slot.id);
      if (pending) {
        this.pending.delete(slot.id);
        pending.resolve(workerFailure(error));
      }
    }
    this.replace(slot);
  }

  private replace(slot: Slot): void {
    if (slot.down) return;
    slot.down = true;
    this.clearWatchdog(slot);
    const workerIndex = this.workers.indexOf(slot);
    if (workerIndex >= 0) this.workers.splice(workerIndex, 1);
    const idleIndex = this.idle.indexOf(slot);
    if (idleIndex >= 0) this.idle.splice(idleIndex, 1);
    slot.id = null;
    slot.timeoutMs = null;
    this.retire(slot.worker);
    if (!this.destroyed) {
      this.spawn();
      this.drain();
    }
  }

  private retire(worker: Worker): Promise<void> {
    const retiring = worker.terminate().then(() => {
      this.terminatedWorkers++;
    });
    this.retiring.add(retiring);
    void retiring.then(
      () => this.retiring.delete(retiring),
      () => this.retiring.delete(retiring),
    );
    return retiring;
  }

  private drain(): void {
    while (!this.destroyed && this.queue.length > 0) {
      if (this.idle.length === 0) {
        if (this.workers.length >= this.size) return;
        this.spawn();
      }
      const slot = this.idle.pop();
      if (!slot) return;
      const task = this.queue.shift()!;
      slot.id = task.id;
      slot.timeoutMs = task.timeoutMs;
      void this.prepare(slot, task);
    }
  }

  private async prepare(slot: Slot, task: Queued): Promise<void> {
    let plan: Plan<Op, PlanBind>;
    try {
      plan = await this.planner.plan(task.request);
    } catch (cause) {
      if (slot.down || this.destroyed || slot.id !== task.id) return;
      const pending = this.pending.get(task.id);
      if (pending) {
        this.pending.delete(task.id);
        pending.resolve(planningFailure(cause));
      }
      slot.id = null;
      slot.timeoutMs = null;
      this.idle.push(slot);
      this.drain();
      return;
    }
    if (slot.down || this.destroyed || slot.id !== task.id) return;
    const known = slot.plans.has(plan.id);
    if (known) {
      slot.plans.delete(plan.id);
      slot.plans.set(plan.id, true);
    } else {
      slot.plans.set(plan.id, true);
      while (slot.plans.size > WORKER_PLAN_CACHE_LIMIT) slot.plans.delete(slot.plans.keys().next().value!);
    }
    try {
      slot.worker.postMessage({
        id: task.id,
        request: task.request,
        planId: plan.id,
        ...(known ? {} : { plan }),
      });
    } catch (cause) {
      const pending = this.pending.get(task.id);
      if (pending) {
        this.pending.delete(task.id);
        pending.reject(cause);
      }
      this.replace(slot);
    }
  }
}
