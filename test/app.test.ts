import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { digest, JsdomEngine, parsePage, parseResult, seal, type CaptureOptions } from '../src/index.js';
import { createNodeApplication } from '../src/node/app.js';

const profilesRoot = path.resolve('profiles');
const probePath = path.resolve('resources/probe.js');

function application(capture: CaptureOptions = { deadlineMs: 100, pollMs: 5, maxPosts: 1 }) {
  const engine = new JsdomEngine();
  const app = createNodeApplication({
    engine,
    profilesRoot,
    probePath,
    capture,
  });
  return { app, engine };
}

test('Application executes run and returns one validated Result contract', async () => {
  const { app, engine } = application();
  const result = await app.execute({
    profile: 'android-webview-v138',
    job: { kind: 'run', code: '({ answer: 6 * 7, realm: Object.getPrototypeOf([]) === Array.prototype })' },
  });

  assert.deepEqual(parseResult(result), result);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { answer: 42, realm: true });
  assert.equal(result.report, undefined);
  assert.equal(engine.active, 0);
});

test('Application capture drives lifecycle events and returns the network report', async () => {
  const { app, engine } = application();
  const result = await app.execute({
    profile: 'android-webview-v138',
    job: {
      kind: 'capture',
      code: `window.addEventListener('load', () => navigator.sendBeacon('/collect', 'event-body')); 'ready'`,
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    syncCaptured: false,
    captured: 'event-body',
    posts: [{ via: 'beacon', tag: '[object String]', len: 10, body: 'event-body' }],
  });
  assert.deepEqual(result.report?.net, {
    body: 'event-body',
    posts: [{ via: 'beacon', tag: '[object String]', len: 10, body: 'event-body' }],
  });
  assert.equal(engine.active, 0);
});

test('Application capture can leave lifecycle events under page control', async () => {
  const { app, engine } = application({ deadlineMs: 20, pollMs: 5, maxPosts: 1, lifecycle: 'none' });
  const result = await app.execute({
    profile: 'android-webview-v138',
    job: {
      kind: 'capture',
      code: `(() => {
        const dispatch = window.dispatchEvent;
        window.dispatchEvent = function(event) {
          if (event.type === 'pageshow') navigator.sendBeacon('/collect', 'forced');
          return dispatch.call(this, event);
        };
        return 'ready';
      })()`,
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { syncCaptured: false, captured: null, posts: [] });
  assert.equal(engine.active, 0);
});

test('Application capture drives the built-in Akamai interaction policy inside the Realm', async () => {
  const { app, engine } = application({ deadlineMs: 1_000, pollMs: 5, maxPosts: 3 });
  const result = await app.execute({
    profile: 'android-webview-v138',
    job: {
      kind: 'capture',
      interaction: { adapter: 'akamai-sensor', seed: 'integration-seed' },
      code: `(() => {
        const manual = new Event('manual');
        document.dispatchEvent(manual);
        const bridgeType = typeof __mimicDispatchTrustedEvent;
        let bridgeLeaked = false;
        const nativeSetTimeout = window.setTimeout;
        window.setTimeout = function(handler, delay, ...args) {
          bridgeLeaked ||= Reflect.ownKeys(globalThis).some(key =>
            typeof key === 'symbol' && key.description?.startsWith('mimic.trusted-dispatch.'));
          return Reflect.apply(nativeSetTimeout, window, [handler, delay, ...args]);
        };
        addEventListener('devicemotion', event => {
          navigator.sendBeacon('/motion', JSON.stringify({
            ctor: event.constructor.name,
            realm: event instanceof DeviceMotionEvent,
            trusted: event.isTrusted,
            manualTrusted: manual.isTrusted,
            bridgeType,
            bridgeLeaked,
            configurable: Object.getOwnPropertyDescriptor(event, 'isTrusted').configurable,
            x: event.acceleration && event.acceleration.x,
          }));
        }, { once: true });
        document.addEventListener('touchstart', event => {
          const list = event.changedTouches;
          const point = event.changedTouches[0];
          const index = Object.getOwnPropertyDescriptor(list, '0');
          const directPoint = new Touch({
            identifier: 9, target: document,
            screenX: 11, screenY: 12, clientX: 13, clientY: 14, pageX: 15, pageY: 16,
            radiusX: 2, radiusY: 3, rotationAngle: 4, force: 0.5,
          });
          const direct = new TouchEvent('direct', { changedTouches: [directPoint] });
          let illegalConstructor = false;
          let brandChecked = false;
          try { new TouchList(); } catch { illegalConstructor = true; }
          try {
            Object.getOwnPropertyDescriptor(TouchList.prototype, 'length').get
              .call(Object.create(TouchList.prototype));
          } catch { brandChecked = true; }
          navigator.sendBeacon('/swipe', JSON.stringify({
            ctor: event.constructor.name,
            realm: event instanceof TouchEvent,
            trusted: event.isTrusted,
            bubbles: event.bubbles,
            x: point.clientX,
            y: point.clientY,
            radiusX: point.radiusX,
            radiusY: point.radiusY,
            force: point.force,
            list: [
              list.constructor.name,
              Object.prototype.toString.call(list),
              list instanceof TouchList,
              Array.isArray(list),
              Object.getPrototypeOf(list) === TouchList.prototype,
              list.item(0) === point,
              list.item(99) === null,
              index.writable,
              index.enumerable,
              index.configurable,
              [...list][0] === point,
              TouchList.prototype[Symbol.iterator] === Array.prototype.values,
            ],
            point: [
              point.constructor.name,
              Object.prototype.toString.call(point),
              point instanceof Touch,
              Object.getPrototypeOf(point) === Touch.prototype,
              point.target === document.body,
            ],
            direct: [
              direct.changedTouches.constructor.name,
              direct.changedTouches instanceof TouchList,
              direct.changedTouches[0] === directPoint,
              direct.changedTouches.item(0) === directPoint,
            ],
            illegalConstructor,
            brandChecked,
          }));
        }, { once: true });
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/initial');
        xhr.send('initial');
      })()`,
    },
  });

  if (!result.ok) assert.fail(result.error.message);
  const posts = (result.value as { posts: Array<{ body: string }> }).posts;
  assert.equal(posts[0]?.body, 'initial');
  const interactionPosts = posts.slice(1).map((post) => JSON.parse(post.body)) as Array<{
    ctor: string;
  }>;
  const motion = (interactionPosts.find((post) => post.ctor === 'DeviceMotionEvent')
    ?? assert.fail('missing DeviceMotionEvent capture')) as {
    ctor: string;
    realm: boolean;
    trusted: boolean;
    manualTrusted: boolean;
    bridgeType: string;
    bridgeLeaked: boolean;
    configurable: boolean;
    x: number;
  };
  const swipe = (interactionPosts.find((post) => post.ctor === 'TouchEvent')
    ?? assert.fail('missing TouchEvent capture')) as {
    ctor: string;
    realm: boolean;
    trusted: boolean;
    bubbles: boolean;
    x: number;
    y: number;
    radiusX: number;
    radiusY: number;
    force: number;
    list: unknown[];
    point: unknown[];
    direct: unknown[];
    illegalConstructor: boolean;
    brandChecked: boolean;
  };
  assert.deepEqual([motion.ctor, motion.realm, typeof motion.x], ['DeviceMotionEvent', true, 'number']);
  assert.deepEqual(
    [motion.trusted, motion.manualTrusted, motion.bridgeType, motion.bridgeLeaked, motion.configurable],
    [true, false, 'undefined', false, false],
  );
  assert.deepEqual([swipe.ctor, swipe.realm, swipe.trusted, swipe.bubbles], ['TouchEvent', true, true, true]);
  assert.deepEqual(swipe.list, [
    'TouchList', '[object TouchList]', true, false, true, true, true, false, true, true, true, true,
  ]);
  assert.deepEqual(swipe.point, ['Touch', '[object Touch]', true, true, true]);
  assert.deepEqual(swipe.direct, ['TouchList', true, true, true]);
  assert.deepEqual([swipe.illegalConstructor, swipe.brandChecked], [true, true]);
  assert.ok(swipe.x >= 0 && swipe.x < 360);
  assert.ok(swipe.y >= 0 && swipe.y < 780);
  assert.ok(swipe.radiusX > 0 && swipe.radiusY > 0);
  assert.ok(swipe.force >= 0 && swipe.force <= 1);
  assert.equal(engine.active, 0);
});

test('Application probe and diagnose are task dispatches over the same Result boundary', async () => {
  const { app, engine } = application();
  const probe = await app.execute({ profile: 'android-webview-v138', job: { kind: 'probe' } });
  assert.equal(probe.ok, true);
  const snapshot = probe.value as {
    meta?: { probeVersion?: number };
    targets?: Array<{ id?: string; collection?: { items?: unknown[] } }>;
  };
  assert.equal(snapshot.meta?.probeVersion, 1);
  assert.ok(Array.isArray(snapshot.targets));
  const touch = snapshot.targets?.find((target) => target.id === 'touch.fixture.invariants');
  assert.equal(touch?.collection?.items?.length, 1);

  const diagnose = await app.execute({
    profile: 'android-webview-v138',
    job: { kind: 'diagnose', code: `eval('20 + 22')`, trace: false },
  });
  assert.equal(diagnose.ok, true);
  assert.equal(diagnose.value, 42);
  assert.deepEqual(diagnose.report?.trace, { dynamicCode: [{ type: 'eval', code: '20 + 22' }] });
  assert.equal(engine.active, 0);
});

test('Application normalizes failures, plans, and profile listing without leaking Runtime state', async () => {
  const { app, engine } = application();
  const request = { profile: 'android-webview-v138', job: { kind: 'run' as const, code: 'throw new Error("boom")' } };
  const plan = await app.plan(request);
  const result = await app.execute(request);

  assert.equal(result.ok, false);
  if (result.ok) assert.fail('expected failure');
  assert.equal(result.plan, plan.id);
  assert.equal(result.error.phase, 'run');
  assert.equal(result.error.code, 'RUN_FAILED');
  assert.match(result.error.message, /boom/);
  assert.ok((await app.list('profiles')).includes('android-webview-v138'));
  assert.ok((await app.list('features')).includes('net'));
  assert.ok((await app.list('drivers')).includes('trace'));
  assert.equal(engine.active, 0);
});

test('Application reuses an identical immutable Job plan without crossing Job boundaries', async () => {
  const { app } = application();
  const request = {
    profile: 'android-webview-v138',
    job: { kind: 'run' as const, code: '1 + 1', timeout: 1_000 },
  };

  const first = await app.plan(request);
  const repeated = await app.plan(structuredClone(request));
  const differentCode = await app.plan({ ...request, job: { ...request.job, code: '2 + 2' } });
  const capture = await app.plan({
    profile: request.profile,
    job: { kind: 'capture', code: request.job.code },
  });

  assert.equal(repeated, first);
  assert.notEqual(differentCode, first);
  assert.deepEqual(differentCode, first);
  assert.notEqual(capture.id, first.id);
});

test('Application excludes the interaction seed from the Plan cache key', async () => {
  const { app } = application();
  const request = {
    profile: 'android-webview-v138',
    job: {
      kind: 'capture' as const,
      code: 'void 0',
      interaction: { adapter: 'akamai-sensor' as const, seed: 'seed-a' },
    },
  };

  const first = await app.plan(request);
  const second = await app.plan({
    ...request,
    job: { ...request.job, interaction: { ...request.job.interaction, seed: 'seed-b' } },
  });

  assert.equal(second, first);
});

test('Application overlays Page fields while inheriting omitted Profile Page state', async () => {
  const { app, engine } = application();
  const now = 1_735_689_600_123;
  const page = parsePage(seal({
    schema: 2 as const,
    id: 'clock-override',
    source: { kind: 'manual' as const, hash: digest('app-page-clock-override') },
    clock: { now, seed: 0x1234_5678 },
  }));
  const request = {
    profile: 'android-webview-v138',
    page,
    job: {
      kind: 'run' as const,
      code: `({
        now: Date.now(),
        connection: [
          navigator.connection.effectiveType,
          navigator.connection.downlink,
          navigator.connection.rtt,
          navigator.connection.saveData,
        ],
      })`,
    },
  };

  const plan = await app.plan(request);
  const result = await app.execute(request);

  assert.equal(plan.page?.id, page.id);
  assert.notEqual(plan.page?.hash, page.hash);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    now,
    connection: ['4g', 9.1, 0, false],
  });
  assert.equal(engine.active, 0);
});
