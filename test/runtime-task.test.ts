import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCaptureResult } from '../src/core/capture.js';
import { digest } from '../src/core/seal.js';
import { createNodePlanner } from '../src/node/planner.js';
import { createNodeRuntime } from '../src/node/runtime.js';
import { JsdomEngine } from '../src/engine/jsdom.js';
import type { Engine } from '../src/engine/types.js';
import { createInteractionSource } from '../src/interaction/dispatch.js';
import { createInteractionSession, synthesizeInteraction } from '../src/interaction/synthesize.js';
import { prepareExecution } from '../src/runtime/task.js';
import { createInteractionPolicy } from '../src/interaction/policies.js';
import { FixtureProfiles } from './fixtures.js';

test('prepared execution separates installation identity from Job and effective capture policy', async () => {
  const planner = createNodePlanner({ profiles: new FixtureProfiles() });
  const job = { kind: 'capture' as const, code: 'void 0', interaction: { adapter: 'akamai-sensor' as const, seed: 'first' } };
  const plan = await planner.plan({ profile: 'chrome-mac', job });
  const first = prepareExecution(job, plan);
  const second = prepareExecution({ ...job, code: '42', interaction: { ...job.interaction, seed: 'second' } }, plan, {
    deadlineMs: 20, lifecycle: 'none', maxPosts: 2,
  });
  assert.equal(first.plan, second.plan);
  assert.equal(first.policy.capture?.deadlineMs, 1_000);
  assert.equal(second.policy.capture?.deadlineMs, 20);
  assert.equal(second.policy.capture?.clock, 'after-script-yield');
  assert.equal(second.policy.capture?.lifecycle, 'none');
  assert.equal(second.policy.capture?.maxPosts, 2);
  assert.equal(second.policy.script.timeoutMs, null);
  assert.equal(second.policy.script.url, null);
  assert.deepEqual(second.policy.capture?.completion, { minimumInteractionMs: 5_000, quietMs: 500 });
  assert.notEqual(first.policy.capture?.interaction.seed, second.policy.capture?.interaction.seed);
  assert.notEqual(first.job, job);
  assert.ok(Object.isFrozen(first.job) && Object.isFrozen(first.policy.capture?.interaction));
  job.interaction.seed = 'mutated';
  assert.equal(first.policy.capture?.interaction.seed, `${plan.id}\u0000akamai-sensor\u0000first`);
  const diagnose = prepareExecution({ kind: 'diagnose', code: '1', trace: false }, plan);
  assert.equal(diagnose.job.kind === 'diagnose' && diagnose.job.trace, true);
  assert.equal(diagnose.policy.capture, null);
});

test('TaskRunner applies the prepared policy, not its constructor defaults, and disposes failed captures', async () => {
  const planner = createNodePlanner({ profiles: new FixtureProfiles() });
  const engine = new JsdomEngine();
  const runner = createNodeRuntime({ engine, capture: { lifecycle: 'none', deadlineMs: 1_000 } });
  const job = { kind: 'capture' as const, code: 'navigator.sendBeacon("/x",document.readyState+":"+document.hasFocus())' };
  const plan = await planner.plan({ profile: 'chrome-mac', job });
  const prepared = prepareExecution(job, plan, { lifecycle: 'auto', deadlineMs: 20, pollMs: 5 });
  const result = parseCaptureResult(await runner.executePrepared(prepared));
  assert.ok(result.ok);
  assert.equal(result.value.captured, 'complete:true');
  assert.equal(engine.active, 0);
  const failed = await runner.executePrepared(prepareExecution({ kind: 'capture', code: 'while(true){}', timeout: 20 }, plan));
  assert.equal(failed.ok, false);
  assert.equal(!failed.ok && failed.error.phase, 'run');
  assert.equal(engine.active, 0);
  assert.deepEqual(await runner.executePrepared(prepared), result);
  assert.equal(engine.active, 0);
});

test('prepared script policy preserves absent versus explicit currentScript URL', async () => {
  const planner = createNodePlanner({ profiles: new FixtureProfiles() });
  const engine = new JsdomEngine();
  const runner = createNodeRuntime({ engine });
  const job = { kind: 'run' as const, code: 'document.currentScript ? document.currentScript.src : null' };
  const plan = await planner.plan({ profile: 'chrome-mac', job });
  const absent = await runner.executePrepared(prepareExecution(job, plan));
  assert.ok(absent.ok);
  assert.equal(absent.value, null);
  const scriptUrl = 'https://example.test/script.js?v=5';
  const explicit = await runner.executePrepared(prepareExecution({ ...job, scriptUrl }, plan));
  assert.ok(explicit.ok);
  assert.equal(explicit.value, scriptUrl);
  assert.equal(engine.active, 0);
});

test('typed capture Result retains v2 fields and rejects malformed successful payloads', () => {
  const value = { syncCaptured: true, captured: 'body', posts: [{ via: 'fetch', tag: '[object String]', len: 4, body: 'body' }] };
  const wire = { ok: true, plan: digest('capture-result'), support: {}, value };
  const parsed = parseCaptureResult(wire);
  assert.deepEqual(parsed, wire);
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.value));
  for (const invalid of [null, {}, { ...value, syncCaptured: 'yes' }, { ...value, posts: [{ body: 'body' }] }]) {
    assert.throws(() => parseCaptureResult({ ...wire, value: invalid }), { code: 'BAD_RESULT', phase: 'parse' });
  }
  const failure = { ok: false, error: { name: 'MimicError', phase: 'run', code: 'RUN_FAILED', message: 'failed' } };
  assert.deepEqual(parseCaptureResult(failure), failure);
});

test('capture synthesis and Realm values survive different polling delays', async () => {
  const planner = createNodePlanner({ profiles: new FixtureProfiles() });
  const job = {
    kind: 'capture' as const,
    interaction: { adapter: 'akamai-sensor' as const, seed: 'replay-clock-probe' },
    code: `(() => {
      window.observedInteraction = [];
      addEventListener('devicemotion', e => observedInteraction.push([
        e.type, e.acceleration.x, e.acceleration.y, e.acceleration.z,
        e.accelerationIncludingGravity.x, e.accelerationIncludingGravity.y, e.accelerationIncludingGravity.z,
        e.rotationRate.alpha, e.rotationRate.beta, e.rotationRate.gamma, e.interval, e.isTrusted,
      ]));
      addEventListener('deviceorientation', e => observedInteraction.push([
        e.type, e.alpha, e.beta, e.gamma, e.absolute, e.isTrusted,
      ]));
      for (const type of ['touchstart', 'touchmove', 'touchend']) {
        document.addEventListener(type, e => {
          const p = e.changedTouches[0];
          observedInteraction.push([e.type, p.clientX, p.clientY, p.pageX, p.pageY, p.force, e.isTrusted]);
        });
      }
      navigator.sendBeacon('/start', 'ready');
    })();`,
  };
  const plan = await planner.plan({ profile: 'android-webview-v138', job });
  const reference = prepareExecution(job, plan);
  const session = createInteractionSession(reference.policy.capture!.interaction.seed);
  const policy = createInteractionPolicy('akamai-sensor', session);
  const expectedSources: string[] = [];
  let pageOffsetYRatio = 0;
  let plannedEndAt = 0;
  for (const [sequence, elapsed] of [120, 2_500, 2_700].entries()) {
    const action = policy.next(elapsed, 1, 0, plannedEndAt);
    assert.ok(action);
    const frames = synthesizeInteraction(action.recipe, session, sequence, action.plannedAtMs);
    plannedEndAt = action.plannedAtMs + frames.at(-1)!.at;
    expectedSources.push(createInteractionSource(frames, pageOffsetYRatio));
    if (action.recipe === 'swipe') {
      const touches = frames.filter(frame => frame.kind === 'touch');
      pageOffsetYRatio += Math.max(0, touches[0]!.y - touches.at(-1)!.y);
    }
  }
  const observations = [];
  for (const pollMs of [10, 250, 1_000]) {
    const underlying = new JsdomEngine();
    const sources: string[] = [];
    let events: unknown[][] = [];
    const engine: Engine = {
      manifest: underlying.manifest,
      open: (preparedPlan, drivers) => {
        const runtime = underlying.open(preparedPlan, drivers);
        return {
          plan: runtime.plan,
          run: (code, options) => {
            if (options?.trustedEvents) sources.push(code);
            return runtime.run(code, options);
          },
          report: () => runtime.report(),
          dispose: () => {
            try {
              const snapshot = runtime.run('JSON.stringify(window.observedInteraction)');
              assert.ok(snapshot.ok && typeof snapshot.value === 'string');
              events = JSON.parse(snapshot.value) as unknown[][];
            } finally {
              runtime.dispose();
            }
          },
        };
      },
    };
    const runner = createNodeRuntime({ engine });
    const result = parseCaptureResult(await runner.executePrepared(prepareExecution(job, plan, {
      deadlineMs: 10_000, pollMs, maxPosts: 20,
    })));
    assert.ok(result.ok);
    assert.equal(result.value.captured, 'ready');
    assert.equal(underlying.active, 0);
    assert.deepEqual(sources, expectedSources, `pollMs=${pollMs} changed the planned program`);
    assert.equal(events.length, 98);
    assert.equal(events.filter(event => event[0] === 'touchstart').length, 3);
    assert.equal(events.filter(event => event[0] === 'touchend').length, 3);
    assert.ok(events.every(event => event.at(-1) === true));
    observations.push(events);
  }
  assert.deepEqual(observations[1], observations[0]);
  assert.deepEqual(observations[2], observations[0]);
});
