// Diagnostic only: inspect the production pool without adding SDK/protocol hooks.
// Requires Node >=24 with Worker.getHeapStatistics(); build before running.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getHeapStatistics } from 'node:v8';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const config = {
  workload: 'fixed', tasks: 1000, batch: 100, size: 1, cycles: 1,
  idleMs: 5000, maps: false, snapshots: false, processes: false,
  profile: 'android-webview/unknown-v138-1',
  profilesRoot: path.join(root, 'test/fixtures/fp-env'),
  ...JSON.parse(process.argv[2] ?? '{}'),
};
if (!config.out) throw new TypeError('out directory is required');
if (!['fixed', 'vary', 'capture'].includes(config.workload)) throw new TypeError('Unknown workload');
for (const key of ['tasks', 'batch', 'size', 'cycles', 'idleMs']) {
  if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new TypeError(`Invalid ${key}`);
}
if (config.batch < config.size) throw new TypeError('batch must be >= size');
await mkdir(config.out, { recursive: true });
await writeFile(path.join(config.out, 'pid'), String(process.pid));
const report = {
  node: process.version, platform: process.platform, cpu: os.cpus()[0].model,
  config, pid: process.pid, samples: [], rounds: [],
};
if (config.processes) {
  report.processCycles = [];
  for (let cycle = 0; cycle < config.cycles; cycle++) {
    const out = path.join(config.out, `process-${cycle}`);
    const start = performance.now();
    const result = await exec(process.execPath, [fileURLToPath(import.meta.url), JSON.stringify({
      ...config, out, cycles: 1, processes: false,
    })], {maxBuffer: 4 * 2**20});
    await writeFile(path.join(out, 'stdout.log'), result.stdout + result.stderr);
    const child = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
    let exited = false;
    try { process.kill(child.pid, 0); } catch (error) { if (error.code === 'ESRCH') exited = true; else throw error; }
    if (!exited) throw new Error(`Child ${child.pid} is still present`);
    const summary = {cycle, pid: child.pid, exited, elapsedMs: performance.now()-start,
      childPeakRss: Math.max(...child.samples.map(sample => sample.memory.rss)), parentMemory: process.memoryUsage()};
    report.processCycles.push(summary);
    console.log(JSON.stringify(summary));
    await writeFile(path.join(config.out, 'report.json'), JSON.stringify(report, null, 2));
  }
  process.exit(0);
}
let executor;
const workers = () => executor?.pool.workers.map(slot => slot.worker) ?? [];
async function sample(stage) {
  const workerHeaps = await Promise.all(workers().map(async worker => ({
    threadId: worker.threadId, limits: worker.resourceLimits,
    heap: await worker.getHeapStatistics(), cpu: await worker.cpuUsage(),
  })));
  const entry = {
    stage, atMs: performance.now(), memory: process.memoryUsage(), usage: process.resourceUsage(), mainHeap: getHeapStatistics(),
    workers: workerHeaps, ...(executor ? { stats: executor.stats, lifecycle: executor.workerLifecycle } : {}),
  };
  report.samples.push(entry);
  await writeFile(path.join(config.out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({stage, rssMiB: entry.memory.rss / 2**20,
    workerHeapMiB: workerHeaps.reduce((sum, value) => sum + value.heap.used_heap_size, 0) / 2**20,
    nativeContexts: workerHeaps.map(value => value.heap.number_of_native_contexts)}));
}
async function map(stage) {
  if (!config.maps || process.platform !== 'darwin') return;
  try {
    const {stdout, stderr} = await exec('/usr/bin/vmmap', ['-summary', String(process.pid)], {maxBuffer: 4 * 2**20, timeout: 20000});
    await writeFile(path.join(config.out, `${stage}.vmmap.txt`), stdout + stderr);
  } catch (error) {
    await writeFile(path.join(config.out, `${stage}.vmmap-error.txt`), String(error) + '\n' + (error.stderr ?? ''));
  }
}
async function snapshot(stage) {
  if (!config.snapshots) return;
  for (const worker of workers()) {
    await pipeline(await worker.getHeapSnapshot(), createWriteStream(path.join(config.out, `${stage}-${worker.threadId}.heapsnapshot`)));
  }
  await sample(`${stage}-after-snapshot-gc`);
}
function request(index) {
  if (config.workload === 'capture') return {
    profile: config.profile,
    job: {kind: 'capture', trace: true, code: `eval('1 + 1'); setTimeout(() => navigator.sendBeacon('/sensor', 'body'), 20);`},
  };
  return {profile: config.profile, job: {kind: 'run', code: config.workload === 'fixed' ? '1 + 1' : `1 + 1; // ${index}`}};
}
async function run(index) {
  const result = await executor.run(request(index));
  if (!result.ok || (config.workload === 'capture' ? result.value.captured !== 'body' : result.value !== 2)) {
    throw new Error(`Invalid task result: ${JSON.stringify(result)}`);
  }
}
await sample('base');
const {WorkerExecutor} = await import('../dist/src/executor/pool.js');
await sample('imported');
try {
  for (let cycle = 0; cycle < config.cycles; cycle++) {
    const startup = performance.now();
    executor = new WorkerExecutor({profilesRoot: config.profilesRoot, size: config.size, maxQueue: config.batch,
      timeoutMs: 10000, capture: {deadlineMs: 500, pollMs: 10, maxPosts: 1}});
    for (let n = 0; n < 20; n += config.size) await Promise.all(Array.from({length: config.size}, (_, i) => run(-n-i-1)));
    const startupMs = performance.now() - startup;
    const prefix = `cycle-${cycle}`;
    await sample(`${prefix}-warm`);
    await map(`${prefix}-warm`);
    await snapshot(`${prefix}-warm`);
    const cpu = process.cpuUsage(), start = performance.now();
    for (let completed = 0; completed < config.tasks;) {
      const count = Math.min(config.batch, config.tasks - completed);
      await Promise.all(Array.from({length: count}, (_, i) => run(cycle * config.tasks + completed + i)));
      completed += count;
      await sample(`${prefix}-tasks-${completed}`);
    }
    report.rounds.push({cycle, startupMs, elapsedMs: performance.now()-start, cpu: process.cpuUsage(cpu)});
    await map(`${prefix}-loaded`);
    await snapshot(`${prefix}-loaded`);
    await new Promise(resolve => setTimeout(resolve, config.idleMs));
    await sample(`${prefix}-idle`);
    await map(`${prefix}-idle`);
    await executor.destroy();
    await sample(`${prefix}-closed`);
    await new Promise(resolve => setTimeout(resolve, config.idleMs));
    await sample(`${prefix}-closed-idle`);
    await map(`${prefix}-closed-idle`);
  }
} finally {
  await executor?.destroy();
  await writeFile(path.join(config.out, 'report.json'), JSON.stringify(report, null, 2));
}
