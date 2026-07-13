import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaskRequest } from '../app/index.js';
import { JsdomEngine } from '../engines/jsdom.js';
import { WorkerExecutor, type ExecutorStats } from '../executor/pool.js';
import { createNodeApplication } from '../node/app.js';

const ROUNDS = 2;
const REPLACEMENT_TIMEOUT_MS = 2_000;

export interface LeakOptions {
  tasksPerRound?: number;
  workerSize?: number;
  timeoutMs?: number;
  profile?: string;
  profilesRoot?: string;
  probePath?: string;
}

interface LeakConfig {
  rounds: 2;
  tasksPerRound: number;
  workerSize: number;
  profile: string;
  profilesRoot: string;
  probePath: string;
}

export interface LeakCheck {
  name: string;
  expected: number | string | boolean;
  actual: number | string | boolean | null;
  passed: boolean;
}

export interface LeakRound {
  round: number;
  tasks: number;
  application: {
    completed: number;
    engineActive: number;
  };
  executor: ExecutorStats & { completed: number };
  memory: {
    rss: number;
    heapUsed: number;
  };
}

export interface LeakWorkloadReport {
  schema: 1;
  config: LeakConfig;
  rounds: LeakRound[];
  final: {
    application: { engineActive: number };
    executor: ExecutorStats;
    workers: { created: number; terminated: number; live: number };
  };
  memory: {
    rssStart: number;
    rssEnd: number;
    rssDelta: number;
    heapUsedStart: number;
    heapUsedEnd: number;
    heapUsedDelta: number;
  };
  gate: {
    status: 'passed' | 'failed';
    checks: LeakCheck[];
    error?: string;
  };
}

export interface LeakGateReport extends LeakWorkloadReport {
  child: {
    naturallyExited: boolean;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    stderr: string;
  };
}

function positive(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function config(options: LeakOptions): LeakConfig & { timeoutMs: number } {
  const tasksPerRound = positive(options.tasksPerRound, 20, 'tasksPerRound');
  const workerSize = positive(options.workerSize, 1, 'workerSize');
  const timeoutMs = positive(options.timeoutMs, 30_000, 'timeoutMs');
  const profile = options.profile ?? 'android-webview-v138';
  if (profile.length === 0) throw new TypeError('profile must be a non-empty id');
  return {
    rounds: ROUNDS,
    tasksPerRound,
    workerSize,
    timeoutMs,
    profile,
    profilesRoot: path.resolve(options.profilesRoot ?? 'profiles'),
    probePath: path.resolve(options.probePath ?? 'harness/probe.js'),
  };
}

function task(profile: string, round: number, index: number): TaskRequest {
  return {
    profile,
    job: { kind: 'run', code: `${round} * 1000 + ${index}` },
  };
}

function resultValue(round: number, index: number): number {
  return round * 1_000 + index;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

function check(
  checks: LeakCheck[],
  name: string,
  expected: number | string | boolean,
  actual: number | string | boolean | null,
): void {
  checks.push({ name, expected, actual, passed: actual === expected });
}

export async function runLeakWorkload(options: LeakOptions = {}): Promise<LeakWorkloadReport> {
  const settings = config(options);
  const { timeoutMs: _timeoutMs, ...reportedConfig } = settings;
  const start = process.memoryUsage();
  const rounds: LeakRound[] = [];
  const engine = new JsdomEngine();
  const application = createNodeApplication({
    engine,
    profilesRoot: settings.profilesRoot,
    probePath: settings.probePath,
  });
  const executor = new WorkerExecutor({
    profilesRoot: settings.profilesRoot,
    probePath: settings.probePath,
    size: settings.workerSize,
    timeoutMs: REPLACEMENT_TIMEOUT_MS,
    maxQueue: settings.tasksPerRound,
  });
  let workloadError: string | undefined;

  try {
    for (let round = 1; round <= ROUNDS; round++) {
      let applicationCompleted = 0;
      for (let index = 0; index < settings.tasksPerRound; index++) {
        const result = await application.execute(task(settings.profile, round, index));
        if (!result.ok || result.value !== resultValue(round, index)) {
          throw new Error(`Application returned an invalid Result at round=${round} task=${index}`);
        }
        applicationCompleted++;
      }

      const workerResults = await Promise.all(Array.from(
        { length: settings.tasksPerRound },
        (_, index) => executor.run(task(settings.profile, round, index)),
      ));
      for (const [index, result] of workerResults.entries()) {
        if (!result.ok || result.value !== resultValue(round, index)) {
          throw new Error(`Worker returned an invalid Result at round=${round} task=${index}`);
        }
      }
      const stats = executor.stats;
      rounds.push({
        round,
        tasks: settings.tasksPerRound,
        application: { completed: applicationCompleted, engineActive: engine.active },
        executor: { ...stats, completed: workerResults.length },
        memory: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed },
      });
    }

    const replaced = await executor.run({
      profile: settings.profile,
      job: { kind: 'run', code: 'Promise.resolve().then(() => { while (true) {} }); 1' },
    });
    if (replaced.ok || !/timed out/i.test(replaced.error.message)) {
      throw new Error('Worker replacement probe did not time out');
    }
    const recovered = await executor.run(task(settings.profile, ROUNDS + 1, 1));
    if (!recovered.ok || recovered.value !== resultValue(ROUNDS + 1, 1)) {
      throw new Error('Worker did not recover after replacement');
    }
  } catch (cause) {
    workloadError = errorMessage(cause);
  } finally {
    try {
      await executor.destroy();
    } catch (cause) {
      workloadError ??= errorMessage(cause);
    }
  }

  const end = process.memoryUsage();
  const finalStats = executor.stats;
  const workers = executor.workerLifecycle;
  const checks: LeakCheck[] = [];
  check(checks, 'rounds.completed', ROUNDS, rounds.length);
  for (const round of rounds) {
    check(checks, `round.${round.round}.application.engineActive`, 0, round.application.engineActive);
    check(checks, `round.${round.round}.executor.active`, 0, round.executor.active);
    check(checks, `round.${round.round}.executor.queued`, 0, round.executor.queued);
  }
  check(checks, 'final.application.engineActive', 0, engine.active);
  check(checks, 'final.executor.active', 0, finalStats.active);
  check(checks, 'final.executor.queued', 0, finalStats.queued);
  check(checks, 'final.executor.idle', 0, finalStats.idle);
  check(checks, 'final.workers.live', 0, workers.live);
  check(checks, 'final.workers.terminated', workers.created, workers.terminated);
  if (workloadError !== undefined) check(checks, 'workload.error', false, true);
  const passed = workloadError === undefined && checks.every((item) => item.passed);

  return {
    schema: 1,
    config: reportedConfig,
    rounds,
    final: {
      application: { engineActive: engine.active },
      executor: finalStats,
      workers,
    },
    memory: {
      rssStart: start.rss,
      rssEnd: end.rss,
      rssDelta: end.rss - start.rss,
      heapUsedStart: start.heapUsed,
      heapUsedEnd: end.heapUsed,
      heapUsedDelta: end.heapUsed - start.heapUsed,
    },
    gate: {
      status: passed ? 'passed' : 'failed',
      checks,
      ...(workloadError === undefined ? {} : { error: workloadError }),
    },
  };
}

function failedReport(settings: ReturnType<typeof config>, message: string): LeakWorkloadReport {
  const { timeoutMs: _timeoutMs, ...reportedConfig } = settings;
  const memory = process.memoryUsage();
  return {
    schema: 1,
    config: reportedConfig,
    rounds: [],
    final: {
      application: { engineActive: -1 },
      executor: { size: settings.workerSize, active: -1, idle: -1, queued: -1, maxQueue: settings.tasksPerRound },
      workers: { created: settings.workerSize, terminated: 0, live: -1 },
    },
    memory: {
      rssStart: memory.rss,
      rssEnd: memory.rss,
      rssDelta: 0,
      heapUsedStart: memory.heapUsed,
      heapUsedEnd: memory.heapUsed,
      heapUsedDelta: 0,
    },
    gate: {
      status: 'failed',
      checks: [{ name: 'child.report', expected: 'valid JSON', actual: message, passed: false }],
      error: message,
    },
  };
}

function childReport(stdout: string, settings: ReturnType<typeof config>): LeakWorkloadReport {
  try {
    const parsed = JSON.parse(stdout) as Partial<LeakWorkloadReport>;
    if (parsed.schema !== 1 || !Array.isArray(parsed.rounds) || parsed.final === undefined || parsed.gate === undefined) {
      throw new TypeError('child report has an invalid shape');
    }
    return parsed as LeakWorkloadReport;
  } catch (cause) {
    return failedReport(settings, `unable to parse child report: ${errorMessage(cause)}`);
  }
}

export async function runLeakGate(options: LeakOptions = {}): Promise<LeakGateReport> {
  const settings = config(options);
  const modulePath = fileURLToPath(import.meta.url);
  const args = [
    modulePath,
    '--child',
    '--tasks', String(settings.tasksPerRound),
    '--worker-size', String(settings.workerSize),
    '--profile', settings.profile,
    '--profiles-root', settings.profilesRoot,
    '--probe-path', settings.probePath,
  ];
  const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let spawnError: string | undefined;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  child.once('error', (cause) => { spawnError = errorMessage(cause); });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, settings.timeoutMs);
  const closed = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);

  const workload = spawnError === undefined
    ? childReport(stdout.trim(), settings)
    : failedReport(settings, `unable to start child process: ${spawnError}`);
  const naturallyExited = !timedOut && closed.signal === null;
  const checks = [...workload.gate.checks];
  check(checks, 'child.naturallyExited', true, naturallyExited);
  check(checks, 'child.exitCode', 0, closed.code);
  const passed = workload.gate.status === 'passed' && checks.every((item) => item.passed);
  return {
    ...workload,
    child: {
      naturallyExited,
      exitCode: closed.code,
      signal: closed.signal,
      timedOut,
      stderr: stderr.trim(),
    },
    gate: {
      status: passed ? 'passed' : 'failed',
      checks,
      ...(workload.gate.error === undefined ? {} : { error: workload.gate.error }),
    },
  };
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function numericFlag(name: string): number | undefined {
  const value = flag(name);
  return value === undefined ? undefined : Number(value);
}

const direct = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const tasksPerRound = numericFlag('tasks');
  const workerSize = numericFlag('worker-size');
  const timeoutMs = numericFlag('timeout');
  const profile = flag('profile');
  const profilesRoot = flag('profiles-root');
  const probePath = flag('probe-path');
  const options: LeakOptions = {
    ...(tasksPerRound === undefined ? {} : { tasksPerRound }),
    ...(workerSize === undefined ? {} : { workerSize }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(profile === undefined ? {} : { profile }),
    ...(profilesRoot === undefined ? {} : { profilesRoot }),
    ...(probePath === undefined ? {} : { probePath }),
  };
  const report = process.argv.includes('--child')
    ? await runLeakWorkload(options)
    : await runLeakGate(options);
  console.log(JSON.stringify(report, null, 2));
  if (report.gate.status === 'failed') process.exitCode = 1;
}
