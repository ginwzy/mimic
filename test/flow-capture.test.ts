import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CapturePool, captureBodies, type CaptureBodiesOptions } from '../flow/capture.js';
import { WorkerExecutor } from '../src/executor/pool.js';
import type { TaskRequest } from '../src/app/types.js';
import { Planner } from '../src/app/planner.js';

const options = {
  profile: 'android-webview/unknown-v138-1',
  profilesRoot: path.resolve('test/fixtures/fp-env'),
  pageUrl: 'https://capture.test/',
  pageHtml: '<!doctype html><html><body>first</body></html>',
  scriptUrl: 'https://capture.test/script.js',
  scriptSource: `window.count = (window.count || 0) + 1;
    navigator.sendBeacon('/capture', JSON.stringify({
      count: window.count, cookie: document.cookie, body: document.body.textContent,
      cores: navigator.hardwareConcurrency
    }));`,
  cookies: ['session=first'],
  deadlineMs: 300,
  scriptTimeoutMs: 5000,
  maxPosts: 1,
  mode: 'bms',
} satisfies CaptureBodiesOptions;

test('flow capture reuses workers and Plans but isolates every Realm and request context', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimic-capture-pool-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(options.profilesRoot, root, { recursive: true });
  const file = path.join(root, '_fp-env/android_138/z__env_1.json');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  raw.navigator.hardwareConcurrency = 3;
  await writeFile(path.join(root, '_fp-env/android_138/z__env_2.json'), JSON.stringify(raw));

  const executors = new Set<WorkerExecutor>();
  const originalRun = WorkerExecutor.prototype.run;
  t.mock.method(WorkerExecutor.prototype, 'run', function (this: WorkerExecutor, request: TaskRequest) {
    executors.add(this);
    return originalRun.call(this, request);
  });
  const originalPlan = Planner.prototype.plan;
  const plans: Awaited<ReturnType<typeof originalPlan>>[] = [];
  t.mock.method(Planner.prototype, 'plan', async function (this: Planner, request: TaskRequest) {
    const plan = await originalPlan.call(this, request);
    plans.push(plan);
    return plan;
  });
  const pool = new CapturePool();
  t.after(() => pool.close());
  const input = { ...options, profilesRoot: root };
  const first = await captureBodies(input, pool);
  assert.deepEqual(await captureBodies(input, pool), first);
  assert.strictEqual(plans[0], plans[1]);
  assert.equal(JSON.parse(first.bodies[0]!).count, 1);
  const changed = await captureBodies({
    ...input, profile: 'android-webview/unknown-v138-2',
    cookies: ['session=second'], pageHtml: '<!doctype html><html><body>second</body></html>',
  }, pool);
  assert.deepEqual(JSON.parse(changed.bodies[0]!), { count: 1, cookie: 'session=second', body: 'second', cores: 3 });
  assert.notStrictEqual(plans[0], plans[2]);
  const queued = await Promise.all([captureBodies(input, pool), captureBodies(input, pool)]);
  assert.deepEqual(queued, [first, first]);
  assert.equal(executors.size, 1);
  const executor = [...executors][0]!;
  assert.equal(executor.workerLifecycle.created, 1);

  await assert.rejects(captureBodies({ ...input, scriptSource: 'window.leaked = 1; throw new Error("failed")' }, pool), /failed/);
  assert.deepEqual(await captureBodies({ ...input, scriptSource: 'navigator.sendBeacon("/capture", String(window.leaked))' }, pool), {
    bodies: ['undefined'], posts: [{ via: 'beacon', tag: '[object String]', len: 9 }],
  });
  assert.equal(executor.workerLifecycle.created, 1);
  assert.strictEqual(pool.close(), pool.close());
  await pool.close();
  assert.equal(executor.workerLifecycle.live, 0);
  await assert.rejects(captureBodies(input, pool), /closed/);
});

test('flow capture keeps capture limits and ABCK interaction state separate in a shared pool', async (t) => {
  const pool = new CapturePool(2);
  t.after(() => pool.close());
  const parallel = await Promise.all(['a', 'b'].map((session) => captureBodies({
    ...options, cookies: [`session=${session}`],
    scriptSource: 'setTimeout(() => navigator.sendBeacon("/capture", document.cookie), 80)',
  }, pool)));
  assert.deepEqual(parallel.map((result) => result.bodies), [['session=a'], ['session=b']]);
  const scriptSource = `navigator.sendBeacon('/capture', 'first');
    setTimeout(() => navigator.sendBeacon('/capture', 'second'), 80);`;
  const [one, two] = await Promise.all([
    captureBodies({ ...options, scriptSource }, pool),
    captureBodies({ ...options, scriptSource, maxPosts: 2 }, pool),
  ]);
  assert.deepEqual(one.bodies, ['first']);
  assert.deepEqual(two.bodies, ['first', 'second']);

  const interactionInput = {
    ...options, deadlineMs: 400, maxPosts: 2,
    scriptSource: `navigator.sendBeacon('/capture', 'first');
      document.addEventListener('pointerdown', () => navigator.sendBeacon('/capture', 'touch'));`,
  };
  const abck = await captureBodies({ ...interactionInput, mode: 'abck', interactionSeed: 'pool-isolation' }, pool);
  assert.deepEqual(abck.bodies, ['first', 'touch']);
  const bms = await captureBodies(interactionInput, pool);
  assert.deepEqual(bms.bodies, ['first']);
  await assert.rejects(captureBodies({ ...options, mode: 'abck' }, pool), /interactionSeed is required/);
});

test('closing a capture pool rejects pending work and terminates its workers', async (t) => {
  const pool = new CapturePool();
  t.after(() => pool.close());
  const rejected = assert.rejects(captureBodies({ ...options, scriptSource: 'void 0', deadlineMs: 30000 }, pool), /destroyed/);
  await pool.close();
  await rejected;
});
