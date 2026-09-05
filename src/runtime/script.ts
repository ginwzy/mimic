import { MimicError } from '../core/error.js';
import type { Runtime } from '../engine/types.js';
import type { ScriptPolicy } from './task.js';

export function executeScript(runtime: Runtime, code: string, policy: ScriptPolicy): unknown {
  const executed = runtime.run(code, {
    ...(policy.url === null ? {} : { url: policy.url }),
    ...(policy.timeoutMs === null ? {} : { timeout: policy.timeoutMs }),
  });
  if (!executed.ok) {
    throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: executed.error, plan: runtime.plan.id });
  }
  const value = executed.value;
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value;
  const identity = runtime.run('window');
  return identity.ok && identity.value === value ? '[unserializable: [object Window]]' : value;
}
