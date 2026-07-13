import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Application, TaskRequest } from '../app/index.js';
import { JsdomEngine } from '../engines/jsdom.js';
import { WorkerExecutor } from '../executor/pool.js';
import { drivers } from '../features/index.js';
import { createNodeApplication } from '../node/app.js';

const DEFAULT_PROFILES = ['chrome-mac', 'android-webview-v138'] as const;
export const DEFAULT_REGRESSION_THRESHOLD = 0.2;

export interface MachineFingerprint {
  platform: NodeJS.Platform;
  arch: string;
  node: string;
  jsdom: string;
  cpu: {
    model: string;
    logical: number;
  };
}

export interface DurationSummary {
  median: number;
  p95: number;
}

export interface ProfilePerformance {
  createMs: DurationSummary;
  cycleThroughputPerSecond: number;
  worker: {
    coldStartMs: number;
    warmThroughputPerSecond: number;
  };
}

export interface PerformanceSnapshot {
  machine: MachineFingerprint;
  profiles: Readonly<Record<string, ProfilePerformance>>;
  rssMax: number;
}

export interface MemoryMetrics {
  rssStart: number;
  rssEnd: number;
  rssMax: number;
  heapUsedStart: number;
  heapUsedEnd: number;
}

export interface ImplementationPerformance {
  profiles: Readonly<Record<string, ProfilePerformance>>;
  rssMax: number;
  memory: MemoryMetrics;
}

export interface PerformanceCheck {
  metric: string;
  direction: 'lower' | 'higher';
  baseline: number;
  candidate: number;
  limit: number;
  passed: boolean;
}

export type PerformanceComparison = {
  status: 'passed' | 'failed' | 'skipped';
  claimable: boolean;
  threshold: number;
  reason?: string;
  checks: PerformanceCheck[];
};

export interface BenchmarkOptions {
  iterations?: number;
  warmup?: number;
  rounds?: number;
  poolSize?: number;
  profiles?: readonly string[];
  root?: string;
  profilesRoot?: string;
  probePath?: string;
}

export interface BenchmarkReport {
  schema: 2;
  machine: MachineFingerprint;
  config: {
    iterations: number;
    warmup: number;
    rounds: number;
    poolSize: number;
    profiles: string[];
  };
  v1: ImplementationPerformance;
  v2: ImplementationPerformance;
  gate: PerformanceComparison;
}

interface RawV1Profile {
  cycle: {
    createMs: DurationSummary;
    throughputPerSecond: number;
  };
  pool: {
    coldStartMs: number;
    warmThroughputPerSecond: number;
  };
}

interface RawV1Report {
  profiles: Record<string, RawV1Profile>;
  memory: MemoryMetrics;
}

interface V1BenchModule {
  benchmarkV1(options: {
    iterations: number;
    warmup: number;
    rounds: number;
    poolSize: number;
    profiles: string[];
  }): Promise<RawV1Report>;
}

type BenchmarkConfig = {
  iterations: number;
  warmup: number;
  rounds: number;
  poolSize: number;
  profiles: string[];
};

function positive(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function nonNegative(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return value;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new RangeError('cannot summarize an empty sample');
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
  return sorted[index]!;
}

function summary(values: readonly number[]): DurationSummary {
  return { median: percentile(values, 0.5), p95: percentile(values, 0.95) };
}

function measured(value: number, metric: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${metric} must be a finite non-negative number`);
  return value;
}

export function currentMachineFingerprint(): MachineFingerprint {
  const require = createRequire(import.meta.url);
  const jsdom = (require('jsdom/package.json') as { version?: unknown }).version;
  if (typeof jsdom !== 'string' || jsdom.length === 0) throw new Error('installed jsdom version is unavailable');
  const cpus = os.cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    jsdom,
    cpu: {
      model: cpus[0]?.model || 'unknown',
      logical: cpus.length,
    },
  };
}

export function sameMachine(left: MachineFingerprint, right: MachineFingerprint): boolean {
  return left.platform === right.platform
    && left.arch === right.arch
    && left.node === right.node
    && left.jsdom === right.jsdom
    && left.cpu.model === right.cpu.model
    && left.cpu.logical === right.cpu.logical;
}

function check(
  checks: PerformanceCheck[],
  metric: string,
  direction: PerformanceCheck['direction'],
  baselineInput: number,
  candidateInput: number,
  threshold: number,
): void {
  const baseline = measured(baselineInput, `${metric}.baseline`);
  const candidate = measured(candidateInput, `${metric}.candidate`);
  const limit = direction === 'lower' ? baseline * (1 + threshold) : baseline * (1 - threshold);
  checks.push({
    metric,
    direction,
    baseline,
    candidate,
    limit,
    passed: direction === 'lower' ? candidate <= limit : candidate >= limit,
  });
}

export function comparePerformance(
  baseline: PerformanceSnapshot,
  candidate: PerformanceSnapshot,
  threshold = DEFAULT_REGRESSION_THRESHOLD,
): PerformanceComparison {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('threshold must be between zero and one');
  }
  if (!sameMachine(baseline.machine, candidate.machine)) {
    return {
      status: 'skipped',
      claimable: false,
      threshold,
      reason: 'machine fingerprint mismatch; a performance claim is not permitted',
      checks: [],
    };
  }

  const profiles = Object.keys(baseline.profiles)
    .filter((profile) => candidate.profiles[profile] !== undefined)
    .sort();
  if (profiles.length === 0) {
    return {
      status: 'skipped',
      claimable: false,
      threshold,
      reason: 'no common profile metrics; a performance claim is not permitted',
      checks: [],
    };
  }

  const checks: PerformanceCheck[] = [];
  for (const profile of profiles) {
    const before = baseline.profiles[profile]!;
    const after = candidate.profiles[profile]!;
    const prefix = `profiles.${profile}`;
    check(checks, `${prefix}.createMs.median`, 'lower', before.createMs.median, after.createMs.median, threshold);
    check(checks, `${prefix}.createMs.p95`, 'lower', before.createMs.p95, after.createMs.p95, threshold);
    check(
      checks,
      `${prefix}.cycleThroughputPerSecond`,
      'higher',
      before.cycleThroughputPerSecond,
      after.cycleThroughputPerSecond,
      threshold,
    );
    check(checks, `${prefix}.worker.coldStartMs`, 'lower', before.worker.coldStartMs, after.worker.coldStartMs, threshold);
    check(
      checks,
      `${prefix}.worker.warmThroughputPerSecond`,
      'higher',
      before.worker.warmThroughputPerSecond,
      after.worker.warmThroughputPerSecond,
      threshold,
    );
  }
  check(checks, 'rssMax', 'lower', baseline.rssMax, candidate.rssMax, threshold);
  const passed = checks.every((item) => item.passed);
  return { status: passed ? 'passed' : 'failed', claimable: true, threshold, checks };
}

function v1Metrics(report: RawV1Report, profiles: readonly string[]): ImplementationPerformance {
  const measuredProfiles: Record<string, ProfilePerformance> = {};
  for (const id of profiles) {
    const profile = report.profiles[id];
    if (!profile) throw new Error(`v1 benchmark did not return profile:${id}`);
    measuredProfiles[id] = {
      createMs: profile.cycle.createMs,
      cycleThroughputPerSecond: profile.cycle.throughputPerSecond,
      worker: {
        coldStartMs: profile.pool.coldStartMs,
        warmThroughputPerSecond: profile.pool.warmThroughputPerSecond,
      },
    };
  }
  return { profiles: measuredProfiles, rssMax: report.memory.rssMax, memory: report.memory };
}

async function applicationCycle(app: Application, engine: JsdomEngine, request: TaskRequest): Promise<{
  createMs: number;
  runMs: number;
  disposeMs: number;
}> {
  const createStart = performance.now();
  const plan = await app.plan(request);
  const runtime = engine.open(plan, drivers);
  const createMs = performance.now() - createStart;
  let runMs = 0;
  let disposeMs = 0;
  try {
    const runStart = performance.now();
    const result = runtime.run('1 + 1');
    runMs = performance.now() - runStart;
    if (!result.ok || result.value !== 2) throw new Error('v2 Application benchmark returned an invalid result');
  } finally {
    const disposeStart = performance.now();
    runtime.dispose();
    disposeMs = performance.now() - disposeStart;
  }
  if (engine.active !== 0) throw new Error(`v2 Application leaked ${engine.active} Runtime(s)`);
  return { createMs, runMs, disposeMs };
}

function validWorkerResult(result: Awaited<ReturnType<WorkerExecutor['run']>>): boolean {
  return result.ok && result.value === 2;
}

async function measureV2Profile(
  profile: string,
  config: { iterations: number; warmup: number; rounds: number; poolSize: number },
  paths: { profilesRoot: string; probePath: string },
  sampleMemory: () => void,
): Promise<ProfilePerformance> {
  const engine = new JsdomEngine();
  const app = createNodeApplication({ engine, profilesRoot: paths.profilesRoot, probePath: paths.probePath });
  const request: TaskRequest = { profile, job: { kind: 'run', code: '1 + 1' } };
  for (let index = 0; index < config.warmup; index++) await applicationCycle(app, engine, request);

  const createMs: number[] = [];
  const cycleThroughput: number[] = [];
  const workerColdStart: number[] = [];
  const workerThroughput: number[] = [];
  for (let round = 0; round < config.rounds; round++) {
    const roundStart = performance.now();
    for (let index = 0; index < config.iterations; index++) {
      const cycle = await applicationCycle(app, engine, request);
      createMs.push(cycle.createMs);
      sampleMemory();
    }
    cycleThroughput.push(config.iterations / ((performance.now() - roundStart) / 1_000));

    const workerStart = performance.now();
    const executor = new WorkerExecutor({
      profilesRoot: paths.profilesRoot,
      probePath: paths.probePath,
      size: config.poolSize,
      maxQueue: Math.max(config.iterations, config.poolSize),
    });
    try {
      const first = await executor.run(request);
      workerColdStart.push(performance.now() - workerStart);
      if (!validWorkerResult(first)) throw new Error(`v2 Worker cold benchmark returned an invalid result:${profile}`);

      const workerWarmup = Array.from({ length: config.poolSize }, () => executor.run(request));
      const primed = await Promise.all(workerWarmup);
      if (primed.some((result) => !validWorkerResult(result))) {
        throw new Error(`v2 Worker priming benchmark returned an invalid result:${profile}`);
      }

      const warmStart = performance.now();
      const results = await Promise.all(Array.from({ length: config.iterations }, () => executor.run(request)));
      workerThroughput.push(config.iterations / ((performance.now() - warmStart) / 1_000));
      if (results.some((result) => !validWorkerResult(result))) {
        throw new Error(`v2 Worker warm benchmark returned an invalid result:${profile}`);
      }
      if (executor.active !== 0 || executor.queued !== 0) {
        throw new Error(`v2 Worker benchmark did not quiesce:${profile}`);
      }
      sampleMemory();
    } finally {
      await executor.destroy();
    }
  }

  if (engine.active !== 0) throw new Error(`v2 benchmark leaked ${engine.active} Runtime(s):${profile}`);
  return {
    createMs: summary(createMs),
    cycleThroughputPerSecond: percentile(cycleThroughput, 0.5),
    worker: {
      coldStartMs: percentile(workerColdStart, 0.5),
      warmThroughputPerSecond: percentile(workerThroughput, 0.5),
    },
  };
}

async function measureV2(
  profiles: readonly string[],
  config: { iterations: number; warmup: number; rounds: number; poolSize: number },
  paths: { profilesRoot: string; probePath: string },
): Promise<ImplementationPerformance> {
  const memoryStart = process.memoryUsage();
  let rssMax = memoryStart.rss;
  const sampleMemory = (): void => { rssMax = Math.max(rssMax, process.memoryUsage().rss); };
  const sampler = setInterval(sampleMemory, 5);
  const measuredProfiles: Record<string, ProfilePerformance> = {};
  try {
    for (const profile of profiles) {
      measuredProfiles[profile] = await measureV2Profile(profile, config, paths, sampleMemory);
    }
  } finally {
    clearInterval(sampler);
    sampleMemory();
  }
  const memoryEnd = process.memoryUsage();
  const memory: MemoryMetrics = {
    rssStart: memoryStart.rss,
    rssEnd: memoryEnd.rss,
    rssMax,
    heapUsedStart: memoryStart.heapUsed,
    heapUsedEnd: memoryEnd.heapUsed,
  };
  return { profiles: measuredProfiles, rssMax, memory };
}

async function measureV1(root: string, config: BenchmarkConfig): Promise<ImplementationPerformance> {
  const moduleUrl = pathToFileURL(path.join(root, 'scripts/v1-bench.js')).href;
  const v1Module = await import(moduleUrl) as V1BenchModule;
  return v1Metrics(await v1Module.benchmarkV1(config), config.profiles);
}

function childMeasurement(
  implementation: 'v1' | 'v2',
  root: string,
  config: BenchmarkConfig,
  paths: { profilesRoot: string; probePath: string },
): Promise<ImplementationPerformance> {
  const args = [
    fileURLToPath(import.meta.url),
    '--implementation', implementation,
    '--root', root,
    '--profiles-root', paths.profilesRoot,
    '--probe-path', paths.probePath,
    '--iterations', String(config.iterations),
    '--warmup', String(config.warmup),
    '--rounds', String(config.rounds),
    '--pool-size', String(config.poolSize),
    '--profiles', config.profiles.join(','),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code !== 0) {
        reject(new Error(`${implementation} benchmark child failed (${code ?? signal}):${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ImplementationPerformance);
      } catch (cause) {
        reject(new Error(`${implementation} benchmark child returned invalid JSON:${stdout.slice(0, 200)}`, { cause }));
      }
    });
  });
}

export async function benchmarkCutover(options: BenchmarkOptions = {}): Promise<BenchmarkReport> {
  const iterations = positive(options.iterations, 30, 'iterations');
  const warmup = nonNegative(options.warmup, 5, 'warmup');
  const rounds = positive(options.rounds, 3, 'rounds');
  const poolSize = positive(options.poolSize, Math.max(1, Math.min(4, os.cpus().length - 1)), 'poolSize');
  const profiles = options.profiles === undefined ? [...DEFAULT_PROFILES] : [...options.profiles];
  if (profiles.length === 0 || profiles.some((profile) => typeof profile !== 'string' || profile.length === 0)) {
    throw new TypeError('profiles must contain at least one non-empty profile id');
  }
  const root = path.resolve(options.root ?? '.');
  const profilesRoot = path.resolve(options.profilesRoot ?? path.join(root, 'profiles'));
  const probePath = path.resolve(options.probePath ?? path.join(root, 'harness/probe.js'));
  const config = { iterations, warmup, rounds, poolSize, profiles };
  const paths = { profilesRoot, probePath };
  const v1 = await childMeasurement('v1', root, config, paths);
  const v2 = await childMeasurement('v2', root, config, paths);
  const machine = currentMachineFingerprint();
  const gate = comparePerformance(
    { machine, profiles: v1.profiles, rssMax: v1.rssMax },
    { machine, profiles: v2.profiles, rssMax: v2.rssMax },
  );
  return { schema: 2, machine, config, v1, v2, gate };
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
  const iterations = numericFlag('iterations');
  const warmup = numericFlag('warmup');
  const rounds = numericFlag('rounds');
  const poolSize = numericFlag('pool-size');
  const profiles = flag('profiles')?.split(',').filter(Boolean);
  const implementation = flag('implementation');
  if (implementation === 'v1' || implementation === 'v2') {
    const root = path.resolve(flag('root') ?? '.');
    const config = {
      iterations: positive(iterations, 30, 'iterations'),
      warmup: nonNegative(warmup, 5, 'warmup'),
      rounds: positive(rounds, 3, 'rounds'),
      poolSize: positive(poolSize, Math.max(1, Math.min(4, os.cpus().length - 1)), 'poolSize'),
      profiles: profiles === undefined ? [...DEFAULT_PROFILES] : profiles,
    };
    const measured = implementation === 'v1'
      ? await measureV1(root, config)
      : await measureV2(config.profiles, config, {
        profilesRoot: path.resolve(flag('profiles-root') ?? path.join(root, 'profiles')),
        probePath: path.resolve(flag('probe-path') ?? path.join(root, 'harness/probe.js')),
      });
    console.log(JSON.stringify(measured));
    process.exit(0);
  }
  const report = await benchmarkCutover({
    ...(iterations === undefined ? {} : { iterations }),
    ...(warmup === undefined ? {} : { warmup }),
    ...(rounds === undefined ? {} : { rounds }),
    ...(poolSize === undefined ? {} : { poolSize }),
    ...(profiles === undefined ? {} : { profiles }),
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.gate.status === 'failed') process.exitCode = 1;
}
