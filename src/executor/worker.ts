import { parentPort, workerData } from 'node:worker_threads';
import { trustPlan } from '../compile/trusted.js';
import { deepFreeze } from '../core/json.js';
import { encodeResult } from '../core/result.js';
import type { Plan, Result } from '../core/types.js';
import { createNodeRuntime } from '../node/runtime.js';
import type { Op, PlanBind } from '../shape/types.js';
import { WORKER_PLAN_CACHE_LIMIT, type ExecuteMessage, type WorkerConfig } from './protocol.js';
import { workerNetwork } from '../network/worker.js';

if (!parentPort) throw new Error('executor/worker must run inside worker_threads');

const app = createNodeRuntime(workerData as WorkerConfig);
const plans = new Map<string, Plan<Op, PlanBind>>();

function failure(cause: unknown): Result {
  const message = cause instanceof Error ? cause.message : String(cause);
  return encodeResult({
    ok: false,
    error: { name: 'MimicError', phase: 'run', code: 'RUN_FAILED', message },
  });
}

parentPort.on('message', async ({ id, job, policy, planId, plan: wire, network }: ExecuteMessage) => {
  parentPort!.postMessage({ id, started: true });
  let result: Result;
  const transport = network ? workerNetwork(network) : undefined;
  try {
    let plan = plans.get(planId);
    if (plan) {
      plans.delete(planId);
      plans.set(planId, plan);
    } else {
      if (wire === undefined || wire.id !== planId) throw new Error(`worker missing Plan:${planId}`);
      plan = trustPlan(deepFreeze(wire));
      plans.set(planId, plan);
      while (plans.size > WORKER_PLAN_CACHE_LIMIT) plans.delete(plans.keys().next().value!);
    }
    const runner = transport ? createNodeRuntime({ ...workerData as WorkerConfig, network: transport }) : app;
    result = await runner.executePrepared({ plan, job: deepFreeze(job), policy: deepFreeze(policy) });
  } catch (cause) {
    result = failure(cause);
  } finally {
    transport?.close();
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  parentPort!.postMessage({ id, result });
});
