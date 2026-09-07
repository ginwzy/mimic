import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { getHeapStatistics } from 'node:v8';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { PreparedExecution } from '../runtime/task.js';

type Mode = 'local' | 'worker';
export interface MemoryOptions {
  tasks?: number;
  warmup?: number;
  sampleEvery?: number;
  profile?: string;
  timeoutMs?: number;
  rssBudgetMiB?: number;
  heapBudgetMiB?: number;
}
interface Config {
  tasks: number;
  warmup: number;
  sampleEvery: number;
  profile: string;
  timeoutMs: number;
  rssBudgetMiB?: number;
  heapBudgetMiB?: number;
}
interface IsolateMemory {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  mallocedMemory: number;
  totalPhysicalSize: number;
}
interface Sample {
  completed: number;
  rss: number;
  main: IsolateMemory;
  worker?: IsolateMemory;
  engineActive: number;
}
export interface MemoryReport {
  schema: 1;
  mode: Mode;
  config: Config;
  gc: true;
  samples: Sample[];
  closed: true;
  growth: { rss: number; mainHeap: number; workerHeap: number };
  memoryGate: { status: 'observed' | 'passed' | 'failed'; checks: { name: string; limit: number; actual: number; passed: boolean }[] };
}

const MiB = 1024 * 1024;
const code = `(() => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const canvas = new frame.contentWindow.OffscreenCanvas(8, 8);
  canvas.getContext('2d');
  return canvas.width;
})()`;

function config(options: MemoryOptions): Config {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !['tasks', 'warmup', 'sampleEvery', 'profile', 'timeoutMs', 'rssBudgetMiB', 'heapBudgetMiB'].includes(key))) {
    throw new TypeError('Invalid memory options');
  }
  const profile = options.profile;
  if (typeof profile !== 'string' || !profile) throw new TypeError('profile must be an explicit fp-env id');
  const output = { tasks: 300, warmup: 20, sampleEvery: 50, timeoutMs: 120_000, ...options, profile };
  for (const key of ['tasks', 'sampleEvery', 'timeoutMs', 'warmup'] as const) {
    if (!Number.isSafeInteger(output[key]) || output[key] < (key === 'warmup' ? 0 : 1)) throw new TypeError(`Invalid ${key}`);
  }
  for (const key of ['rssBudgetMiB', 'heapBudgetMiB'] as const) {
    const value = output[key];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new TypeError(`Invalid ${key}`);
  }
  return output;
}

async function collectGarbage(): Promise<void> {
  if (typeof global.gc !== 'function') throw new Error('Memory observation requires --expose-gc in both isolates');
  for (let i = 0; i < 2; i++) {
    await new Promise<void>(resolve => setImmediate(resolve));
    global.gc();
  }
}

function isolateMemory(): IsolateMemory {
  const { heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
  const { malloced_memory: mallocedMemory, total_physical_size: totalPhysicalSize } = getHeapStatistics();
  return { heapUsed, heapTotal, external, arrayBuffers, mallocedMemory, totalPhysicalSize };
}

export function memoryBudget(growth: MemoryReport['growth'], options: MemoryOptions): MemoryReport['memoryGate'] {
  const checks: MemoryReport['memoryGate']['checks'] = [];
  if (options.rssBudgetMiB !== undefined) checks.push({ name: 'rss.growth', limit: options.rssBudgetMiB * MiB, actual: growth.rss, passed: growth.rss <= options.rssBudgetMiB * MiB });
  if (options.heapBudgetMiB !== undefined) {
    for (const name of ['mainHeap', 'workerHeap'] as const) checks.push({ name: `${name}.growth`, limit: options.heapBudgetMiB * MiB, actual: growth[name], passed: growth[name] <= options.heapBudgetMiB * MiB });
  }
  return { status: checks.length === 0 ? 'observed' : checks.every(check => check.passed) ? 'passed' : 'failed', checks };
}

// Quality-only worker: the production TaskRunner/Engine execute the same prepared task.
// No sampling commands or GC controls are added to the public SDK or production protocol.
async function workerMain(): Promise<void> {
  const { createNodeRuntime } = await import('../node/runtime.js');
  const { JsdomEngine } = await import('../engine/jsdom.js');
  const { deepFreeze } = await import('../core/json.js');
  const { trustPlan } = await import('../compile/trusted.js');
  const engine = new JsdomEngine();
  const runner = createNodeRuntime({ engine });
  let task: PreparedExecution | undefined;
  parentPort!.on('message', async (message: { sample?: true; task?: PreparedExecution }) => {
    try {
      if (message.sample) {
        await collectGarbage();
        parentPort!.postMessage({ memory: isolateMemory(), engineActive: engine.active });
      } else {
        if (message.task) task = deepFreeze({ ...message.task, plan: trustPlan(deepFreeze(message.task.plan)) });
        if (!task) throw new Error('Missing prepared workload');
        const result = await runner.executePrepared(task);
        if (!result.ok || result.value !== 8 || engine.active !== 0) throw new Error('Worker workload failed');
        parentPort!.postMessage({ completed: true });
      }
    } catch (cause) {
      parentPort!.postMessage({ error: cause instanceof Error ? cause.message : String(cause) });
    }
  });
  parentPort!.postMessage({ ready: true });
}

async function workload(mode: Mode, settings: Config): Promise<MemoryReport> {
  const { createNodePlanner } = await import('../node/planner.js');
  const { prepareExecution } = await import('../runtime/task.js');
  const planner = createNodePlanner();
  const job = { kind: 'run' as const, code };
  const task = prepareExecution(job, await planner.plan({ profile: settings.profile, job }));
  const samples: Sample[] = [];
  let worker: Worker | undefined;
  let local: Awaited<ReturnType<typeof import('../node/runtime.js')['createNodeRuntime']>> | undefined;
  let engine: import('../engine/jsdom.js').JsdomEngine | undefined;
  let sent = false;
  async function request(message: object): Promise<{ memory: IsolateMemory; engineActive: number }> {
    const response = once(worker!, 'message');
    worker!.postMessage(message);
    const [value] = await response;
    if (value.error) throw new Error(value.error);
    return value;
  }
  async function execute(): Promise<void> {
    if (worker) {
      await request(sent ? {} : { task });
      sent = true;
    } else {
      const result = await local!.executePrepared(task);
      if (!result.ok || result.value !== 8 || engine!.active !== 0) throw new Error('Local workload failed');
    }
  }
  async function sample(completed: number): Promise<void> {
    const remote = worker ? await request({ sample: true }) : undefined;
    await collectGarbage();
    samples.push({ completed, rss: process.memoryUsage().rss, main: isolateMemory(),
      ...(remote ? { worker: remote.memory } : {}), engineActive: remote?.engineActive ?? engine!.active });
  }
  try {
    if (mode === 'worker') {
      worker = new Worker(new URL(import.meta.url), { workerData: 'mimic-memory' });
      await once(worker, 'message');
    } else {
      const { createNodeRuntime } = await import('../node/runtime.js');
      const { JsdomEngine } = await import('../engine/jsdom.js');
      engine = new JsdomEngine();
      local = createNodeRuntime({ engine });
    }
    for (let i = 0; i < settings.warmup; i++) await execute();
    await sample(0);
    for (let i = 1; i <= settings.tasks; i++) {
      await execute();
      if (i % settings.sampleEvery === 0 || i === settings.tasks) await sample(i);
    }
  } finally {
    if (worker) await worker.terminate();
  }
  const baseline = samples[0]!;
  const growth = {
    rss: Math.max(0, ...samples.map(value => value.rss - baseline.rss)),
    mainHeap: Math.max(0, ...samples.map(value => value.main.heapUsed - baseline.main.heapUsed)),
    workerHeap: Math.max(0, ...samples.map(value => (value.worker?.heapUsed ?? 0) - (baseline.worker?.heapUsed ?? 0))),
  };
  return { schema: 1, mode, config: settings, gc: true, samples, closed: true, growth, memoryGate: memoryBudget(growth, settings) };
}

export async function runMemoryGate(options: MemoryOptions = {}): Promise<MemoryReport[]> {
  const settings = config(options);
  const reports: MemoryReport[] = [];
  for (const mode of ['local', 'worker'] as const) {
    const child = spawn(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--child', mode, JSON.stringify(settings)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', data => { stdout += data; });
    child.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, settings.timeoutMs);
    let exit: number | null;
    try { [exit] = await once(child, 'close') as [number | null]; }
    finally { clearTimeout(timer); }
    if (timedOut || exit === null || !stdout.trim()) throw new Error(`Memory child ${mode} failed: ${timedOut ? 'timeout' : stderr}`);
    const report = JSON.parse(stdout) as MemoryReport;
    if (report.schema !== 1 || report.mode !== mode || !report.closed || (exit !== 0 && report.memoryGate.status !== 'failed')) throw new Error(`Memory child ${mode} failed: ${stderr}`);
    reports.push(report);
  }
  return reports;
}

if (!isMainThread && workerData === 'mimic-memory') {
  await workerMain();
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--child') {
      const mode = process.argv[3];
      if (mode !== 'local' && mode !== 'worker') throw new TypeError('Invalid memory mode');
      const report = await workload(mode, config(JSON.parse(process.argv[4] ?? '{}')));
      console.log(JSON.stringify(report));
      if (report.memoryGate.status === 'failed') process.exitCode = 1;
    } else {
      const reports = await runMemoryGate(JSON.parse(process.argv[2] ?? '{}'));
      console.log(JSON.stringify(reports));
      if (reports.some(report => report.memoryGate.status === 'failed')) process.exitCode = 1;
    }
  } catch (cause) {
    console.error(cause);
    process.exitCode = 1;
  }
}
