import { parentPort, workerData } from 'node:worker_threads';
import { executePrepared, type TaskRequest } from '../app/index.js';
import { trustPlan } from '../compile/trusted.js';
import { deepFreeze } from '../core/json.js';
import { encodeResult } from '../core/result.js';
import type { Plan, Result } from '../core/types.js';
import { createNodeApplication } from '../node/app.js';
import type { Op, PlanBind } from '../shape/types.js';
import type { WorkerConfig } from './pool.js';

if (!parentPort) throw new Error('executor/worker must run inside worker_threads');

const app = createNodeApplication(workerData as WorkerConfig);
const plans = new Map<string, Plan<Op, PlanBind>>();
const PLAN_CACHE_LIMIT = 128;

function failure(cause: unknown): Result {
  const message = cause instanceof Error ? cause.message : String(cause);
  return encodeResult({
    ok: false,
    error: { name: 'MimicError', phase: 'run', code: 'RUN_FAILED', message },
  });
}

parentPort.on('message', async ({ id, request, planId, plan: wire }: {
  id: number;
  request: TaskRequest;
  planId: string;
  plan?: Plan<Op, PlanBind>;
}) => {
  parentPort!.postMessage({ id, started: true });
  let result: Result;
  try {
    let plan = plans.get(planId);
    if (plan) {
      plans.delete(planId);
      plans.set(planId, plan);
    } else {
      if (wire === undefined || wire.id !== planId) throw new Error(`worker missing Plan:${planId}`);
      plan = trustPlan(deepFreeze(wire));
      plans.set(planId, plan);
      while (plans.size > PLAN_CACHE_LIMIT) plans.delete(plans.keys().next().value!);
    }
    result = await executePrepared(app, request, plan);
  } catch (cause) {
    result = failure(cause);
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  parentPort!.postMessage({ id, result });
});
