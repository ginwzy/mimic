import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const RESULT_PREFIX = '__CEBU_CAPTURE_RESULT__';

interface BridgeResult {
  readonly ok: boolean;
  readonly events?: string;
  readonly bodies?: string[];
  readonly error?: unknown;
}

function runBridge(input: object): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('test/cebu_capture.mjs')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const marker = stdout.lastIndexOf(RESULT_PREFIX);
      if (code !== 0 || marker < 0) {
        reject(new Error(`cebu_capture exited ${code ?? signal}: ${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(stdout.slice(marker + RESULT_PREFIX.length)) as BridgeResult);
    });
    child.stdin.end(JSON.stringify(input));
  });
}

test('ANA/Cebu bridge forwards independent seeds to the model-backed ABCK adapter', { timeout: 15_000 }, async () => {
  const input = {
    pageUrl: 'https://example.test/booking',
    pageHtml: '<!doctype html><html><body></body></html>',
    scriptUrl: 'https://example.test/akamai.js',
    scriptSource: `(() => {
      const post = body => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/sensor');
        xhr.send(body);
      };
      addEventListener('devicemotion', event => post(JSON.stringify({
        kind: 'motion',
        trusted: event.isTrusted,
        acceleration: event.acceleration,
      })), { once: true });
      document.addEventListener('touchstart', event => {
        const point = event.changedTouches[0];
        post(JSON.stringify({
          kind: 'touch',
          trusted: event.isTrusted,
          touchInstance: point instanceof Touch,
          clientX: point.clientX,
          clientY: point.clientY,
          radiusX: point.radiusX,
          radiusY: point.radiusY,
          force: point.force,
        }));
      }, { once: true });
      document.addEventListener('pointerdown', event => post(JSON.stringify({
        kind: 'pointer',
        trusted: event.isTrusted,
        pointerInstance: event instanceof PointerEvent,
        mouseInstance: event instanceof MouseEvent,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        clientX: event.clientX,
        clientY: event.clientY,
        width: event.width,
        height: event.height,
        pressure: event.pressure,
        buttons: event.buttons,
      })), { once: true });
      post('initial');
    })()`,
    profile: 'android-webview-v138',
    cookies: [],
    deadlineMs: 2_000,
    maxPosts: 4,
    scriptTimeoutMs: 5_000,
    events: 'abck',
  };
  const [result, otherResult] = await Promise.all([
    runBridge({ ...input, interactionSeed: 'flow-seed-a' }),
    runBridge({ ...input, interactionSeed: 'flow-seed-b' }),
  ]);

  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(otherResult.ok, true, JSON.stringify(otherResult.error));
  assert.equal(result.events, 'abck');
  assert.ok(result.bodies);
  assert.equal(result.bodies[0], 'initial');
  const reports = result.bodies.slice(1).map((body) => JSON.parse(body) as Record<string, unknown>);
  const motion = reports.find((report) => report.kind === 'motion');
  const pointer = reports.find((report) => report.kind === 'pointer');
  const touch = reports.find((report) => report.kind === 'touch');
  assert.ok(motion);
  assert.ok(pointer);
  assert.ok(touch);
  assert.equal(motion.trusted, true);
  assert.equal(typeof (motion.acceleration as { x?: unknown } | undefined)?.x, 'number');
  assert.deepEqual(
    [pointer.trusted, pointer.pointerInstance, pointer.mouseInstance, pointer.pointerType, pointer.isPrimary],
    [true, true, true, 'touch', true],
  );
  assert.equal(pointer.buttons, 1);
  assert.deepEqual([touch.trusted, touch.touchInstance], [true, true]);
  assert.ok((touch.radiusX as number) > 0);
  assert.ok((touch.radiusY as number) > 0);
  assert.ok((touch.force as number) >= 0 && (touch.force as number) <= 1);
  assert.deepEqual([pointer.clientX, pointer.clientY], [touch.clientX, touch.clientY]);
  assert.equal(pointer.width, (touch.radiusX as number) * 2);
  assert.equal(pointer.height, (touch.radiusY as number) * 2);
  assert.ok(Math.abs((pointer.pressure as number) - (touch.force as number)) < 1e-6);
  assert.ok(reports.indexOf(pointer) < reports.indexOf(touch));
  assert.ok(otherResult.bodies);
  const otherTouch = otherResult.bodies
    .slice(1)
    .map((body) => JSON.parse(body) as Record<string, unknown>)
    .find((report) => report.kind === 'touch');
  assert.notDeepEqual(touch, otherTouch);
});

test('ANA/Cebu separates canceled swipe and trusted tap compatibility events', { timeout: 15_000 }, async () => {
  const result = await runBridge({
    pageUrl: 'https://example.test/booking',
    pageHtml: '<!doctype html><html><body><main>booking</main></body></html>',
    scriptUrl: 'https://example.test/akamai.js',
    scriptSource: `(() => {
      const events = [];
      const types = [
        'pointerover', 'pointerenter', 'pointerdown', 'pointermove', 'pointercancel',
        'pointerup', 'pointerout', 'pointerleave',
        'touchstart', 'touchmove', 'touchend',
        'mouseover', 'mouseenter', 'mousedown', 'mousemove', 'mouseup', 'click',
      ];
      const eventPoint = event => event.changedTouches && event.changedTouches[0] || event;
      for (const type of types) {
        document.addEventListener(type, event => events.push({
          type,
          trusted: event.isTrusted,
          target: event.target && event.target.tagName,
          constructor: event.constructor.name,
          pointerType: event.pointerType,
          isPrimary: event.isPrimary,
          button: event.button,
          buttons: event.buttons,
          detail: event.detail,
          which: event.which,
          clientX: eventPoint(event).clientX,
          clientY: eventPoint(event).clientY,
        }), true);
      }
      const post = body => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/sensor');
        xhr.send(body);
      };
      post('initial');
      setTimeout(() => post(JSON.stringify({ kind: 'sequence', events })), 5300);
    })()`,
    profile: 'android-webview-v138',
    cookies: [],
    deadlineMs: 6_000,
    maxPosts: 2,
    scriptTimeoutMs: 7_000,
    events: 'abck',
    interactionSeed: 'pointer-cancel-seed',
  });

  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.ok(result.bodies);
  assert.equal(result.bodies[0], 'initial');
  const report = JSON.parse(result.bodies[1]!) as {
    readonly kind: string;
    readonly events: readonly {
      readonly type: string;
      readonly trusted: boolean;
      readonly target?: string;
      readonly constructor: string;
      readonly pointerType?: string;
      readonly isPrimary?: boolean;
      readonly button?: number;
      readonly buttons?: number;
      readonly detail?: number;
      readonly which?: number;
      readonly clientX?: number;
      readonly clientY?: number;
    }[];
  };
  assert.equal(report.kind, 'sequence');
  const types = report.events.map((event) => event.type);
  assert.deepEqual(types.slice(0, 4), ['pointerover', 'pointerenter', 'pointerdown', 'touchstart']);
  assert.ok(types.indexOf('pointermove') < types.indexOf('pointercancel'));
  assert.ok(types.indexOf('touchmove') < types.indexOf('pointercancel'));
  assert.ok(types.indexOf('pointercancel') < types.indexOf('touchend'));
  const cancelIndex = types.indexOf('pointercancel');
  assert.deepEqual(types.slice(cancelIndex, cancelIndex + 3), ['pointercancel', 'pointerout', 'pointerleave']);
  const swipeEnd = types.indexOf('touchend');
  assert.ok(!types.slice(0, swipeEnd).includes('pointerup'));
  assert.ok(!types.slice(0, swipeEnd).some((type) => ['mousedown', 'mousemove', 'mouseup', 'click'].includes(type)));

  const tapStart = types.indexOf('pointerover', swipeEnd + 1);
  assert.notEqual(tapStart, -1, JSON.stringify(types));
  const followUpStart = types.indexOf('pointerover', tapStart + 1);
  assert.notEqual(followUpStart, -1, JSON.stringify(types));
  const tapTypes = types.slice(tapStart, followUpStart);
  assert.deepEqual(tapTypes, [
    'pointerover', 'pointerenter', 'pointerdown', 'touchstart',
    'pointerup', 'pointerout', 'pointerleave', 'touchend',
    'mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click',
  ]);
  const tapEvents = report.events.slice(tapStart, followUpStart);
  const tapPoint = tapEvents.find((event) => event.type === 'pointerdown');
  assert.ok(tapPoint);
  const compatibilityEvents = tapEvents.slice(-6);
  assert.deepEqual(compatibilityEvents.map((event) => event.constructor), [
    'MouseEvent', 'MouseEvent', 'MouseEvent', 'MouseEvent', 'MouseEvent', 'PointerEvent',
  ]);
  assert.deepEqual(compatibilityEvents.map((event) => [event.button, event.buttons, event.detail]), [
    [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1], [0, 0, 1],
  ]);
  assert.deepEqual(compatibilityEvents.map((event) => event.which), [0, 0, 0, 1, 1, 1]);
  assert.ok(compatibilityEvents.every((event) => (
    event.clientX === tapPoint.clientX && event.clientY === tapPoint.clientY
  )));
  assert.deepEqual(
    [compatibilityEvents.at(-1)?.pointerType, compatibilityEvents.at(-1)?.isPrimary],
    ['touch', false],
  );
  assert.deepEqual(types.slice(followUpStart, followUpStart + 4), [
    'pointerover', 'pointerenter', 'pointerdown', 'touchstart',
  ]);
  assert.ok(!types.slice(followUpStart).some((type) => (
    ['mousedown', 'mousemove', 'mouseup', 'click'].includes(type)
  )));
  assert.ok(report.events.every((event) => event.trusted));
  assert.ok(report.events.every((event) => event.target === 'BODY'));
});
