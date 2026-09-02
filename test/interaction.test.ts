import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { CSD4CA_MODEL } from '../src/interaction/csd4ca.model.js';
import { createInteractionSource } from '../src/interaction/dispatch.js';
import { createInteractionPolicy } from '../src/interaction/policies.js';
import { createInteractionSession, synthesizeInteraction } from '../src/interaction/synthesize.js';

function synthesize(recipe: 'swipe' | 'tap', seed: string, sequence: number) {
  return synthesizeInteraction(recipe, createInteractionSession(seed), sequence, 0);
}

test('CSD4CA interaction model is anonymous, compact and structurally complete', () => {
  assert.equal(CSD4CA_MODEL.schema, 3);
  assert.equal(CSD4CA_MODEL.compiler, 3);
  assert.equal(CSD4CA_MODEL.frames, 16);
  assert.equal(CSD4CA_MODEL.stride, 13);
  assert.deepEqual(CSD4CA_MODEL.timingChannels, [
    'touchLogDuration', 'sensorStartOffset', 'sensorEndOffset',
  ]);
  assert.equal(CSD4CA_MODEL.calibration.maxBoundaryOffsetMs, 150);
  assert.equal(CSD4CA_MODEL.source.license, 'CC-BY-4.0');
  assert.equal(CSD4CA_MODEL.source.doi, '10.5281/zenodo.17931118');
  assert.equal(CSD4CA_MODEL.groups.length, 6);
  assert.equal(CSD4CA_MODEL.groups.reduce((sum, group) => sum + group.count, 0), 21_162);
  assert.equal(CSD4CA_MODEL.groups.reduce((sum, group) => sum + group.sessions.length, 0), 288);
  assert.equal(CSD4CA_MODEL.groups.reduce((sum, group) => (
    sum + group.sessions.reduce((groupSum, session) => groupSum + session.transitions.count, 0)
  ), 0), 20_838);
  for (const group of CSD4CA_MODEL.groups) {
    assert.equal(group.direction, 'up');
    assert.equal(
      group.mean.length,
      CSD4CA_MODEL.frames * CSD4CA_MODEL.stride + CSD4CA_MODEL.timingChannels.length,
    );
    assert.equal(group.components.length, 31);
    assert.ok(group.sessions.every((session) => (
      session.gestureCount >= CSD4CA_MODEL.calibration.minimumSessionPoseGestures
      && session.gravity.length === 3
      && session.gravity.every(Number.isFinite)
      && Buffer.from(session.transitions.data, 'base64').byteLength === session.transitions.count * 10
    )));
    assert.ok(group.components.every((component) => component.basis.length === group.mean.length));
    assert.ok(group.quality.varianceRetained >= 0.95);
    assert.ok(group.quality.crossModalCovarianceRetained >= 0.92);
  }
});

test('interaction synthesis is model-backed, seeded, bounded and time ordered', () => {
  const first = synthesize('swipe', 'seed-a', 0);
  const repeated = synthesize('swipe', 'seed-a', 0);
  const changed = synthesize('swipe', 'seed-b', 0);
  const tap = synthesize('tap', 'seed-a', 0);

  assert.deepEqual(repeated, first);
  assert.notDeepEqual(changed, first);
  assert.ok(first.length > 0);
  let previousAt = 0;
  for (const frame of first) {
    assert.ok(frame.at >= previousAt);
    previousAt = frame.at;
    if (frame.kind === 'touch') {
      assert.ok(frame.x >= 0 && frame.x <= 1);
      assert.ok(frame.y >= 0 && frame.y <= 1);
    }
  }
  const touches = first.filter((frame) => frame.kind === 'touch');
  const swipeMotions = first.filter((frame) => frame.kind === 'motion');
  const swipeOrientations = first.filter((frame) => frame.kind === 'orientation');
  assert.equal(first.length, CSD4CA_MODEL.frames * 3);
  assert.equal(touches.length, CSD4CA_MODEL.frames);
  assert.equal(swipeMotions.length, CSD4CA_MODEL.frames);
  assert.equal(swipeOrientations.length, CSD4CA_MODEL.frames);
  assert.deepEqual([touches[0]?.phase, touches.at(-1)?.phase], ['start', 'end']);
  assert.ok(touches[0]!.y - touches.at(-1)!.y >= 0.08);
  assert.ok(touches.every((frame) => frame.radiusX > 0 && frame.radiusY > 0));
  assert.ok(touches.every((frame) => frame.force >= 0 && frame.force <= 1));
  assert.deepEqual(swipeMotions.map((frame) => frame.at), swipeOrientations.map((frame) => frame.at));
  assert.ok(Math.abs(swipeMotions[0]!.at - touches[0]!.at) <= CSD4CA_MODEL.calibration.maxBoundaryOffsetMs);
  assert.ok(Math.abs(swipeMotions.at(-1)!.at - touches.at(-1)!.at) <= CSD4CA_MODEL.calibration.maxBoundaryOffsetMs);
  assert.ok(swipeMotions.every((frame) => frame.interval > 0));
  assert.ok(swipeMotions.every((frame) => (
    [...frame.acceleration, ...frame.gravity, ...frame.rotation].every(Number.isFinite)
  )));

  assert.equal(tap.length, 2);
  const [tapStart, tapEnd] = tap;
  assert.ok(tapStart?.kind === 'touch' && tapEnd?.kind === 'touch');
  assert.deepEqual([tapStart.phase, tapEnd.phase], ['start', 'end']);
  assert.ok(tapEnd.at >= 70 && tapEnd.at <= 130);
  assert.deepEqual(
    [tapEnd.x, tapEnd.y, tapEnd.radiusX, tapEnd.radiusY, tapEnd.force],
    [tapStart.x, tapStart.y, tapStart.radiusX, tapStart.radiusY, tapStart.force],
  );
});

test('joint swipe synthesis retains calibrated sensor timing spread', () => {
  const startOffsets: number[] = [];
  const endOffsets: number[] = [];
  for (let index = 0; index < 1_000; index += 1) {
    const frames = synthesize('swipe', `timing-spread-${index}`, 0);
    const touches = frames.filter((frame) => frame.kind === 'touch');
    const motions = frames.filter((frame) => frame.kind === 'motion');
    startOffsets.push(motions[0]!.at - touches[0]!.at);
    endOffsets.push(motions.at(-1)!.at - touches.at(-1)!.at);
  }

  const boundary = CSD4CA_MODEL.calibration.maxBoundaryOffsetMs;
  assert.ok([...startOffsets, ...endOffsets].every((offset) => Math.abs(offset) <= boundary));
  assert.ok(Math.min(...startOffsets) <= -20);
  assert.ok(Math.max(...startOffsets) >= 30);
  assert.ok(Math.min(...endOffsets) <= -30);
  assert.ok(Math.max(...endOffsets) >= 30);
});

test('interaction session preserves relative orientation and source pose continuity', () => {
  const gravityDeltas: number[] = [];
  const headingDeltas: number[] = [];
  for (let index = 0; index < 1_000; index += 1) {
    const session = createInteractionSession(`pose-session-${index}`);
    const initial = synthesizeInteraction('swipe', session, 0, 120);
    const followUp = synthesizeInteraction('swipe', session, 2, 2_700);
    const initialMotion = initial.filter((frame) => frame.kind === 'motion');
    const followUpMotion = followUp.filter((frame) => frame.kind === 'motion');
    const initialOrientation = initial.filter((frame) => frame.kind === 'orientation');
    const followUpOrientation = followUp.filter((frame) => frame.kind === 'orientation');

    assert.equal(initialOrientation[0]!.alpha, 0);
    for (const [motion, orientation] of initialMotion.map((frame, frameIndex) => (
      [frame, initialOrientation[frameIndex]!] as const
    ))) {
      const [x, y, z] = motion.gravity;
      assert.equal(orientation.beta, Number((Math.atan2(y, z) * 180 / Math.PI).toFixed(1)));
      assert.equal(orientation.gamma, Number((Math.atan2(-x, Math.hypot(y, z)) * 180 / Math.PI).toFixed(1)));
    }

    const median = (values: readonly number[]) => {
      const sorted = [...values].sort((left, right) => left - right);
      return (sorted[7]! + sorted[8]!) / 2;
    };
    const baseline = (frames: typeof initialMotion) => [0, 1, 2].map((axis) => (
      median(frames.map((frame) => frame.gravity[axis]!))
    ));
    const initialGravity = baseline(initialMotion);
    const followUpGravity = baseline(followUpMotion);
    gravityDeltas.push(Math.hypot(...initialGravity.map((value, axis) => value - followUpGravity[axis]!)));

    const circularMean = (frames: typeof initialOrientation) => Math.atan2(
      frames.reduce((sum, frame) => sum + Math.sin(frame.alpha * Math.PI / 180), 0),
      frames.reduce((sum, frame) => sum + Math.cos(frame.alpha * Math.PI / 180), 0),
    ) * 180 / Math.PI;
    const headingDelta = circularMean(followUpOrientation) - circularMean(initialOrientation);
    headingDeltas.push(Math.abs((headingDelta + 540) % 360 - 180));
  }

  gravityDeltas.sort((left, right) => left - right);
  headingDeltas.sort((left, right) => left - right);
  assert.ok(gravityDeltas[499]! < 0.8);
  assert.ok(gravityDeltas[989]! < 5);
  assert.ok(headingDeltas[499]! < 3);
});

test('interaction session conditions pose transitions on gesture spacing', () => {
  const shortSession = createInteractionSession('pose-spacing');
  const longSession = createInteractionSession('pose-spacing');
  const shortInitial = synthesizeInteraction('swipe', shortSession, 0, 120);
  const longInitial = synthesizeInteraction('swipe', longSession, 0, 120);
  assert.deepEqual(shortInitial, longInitial);

  const shortFollowUp = synthesizeInteraction('swipe', shortSession, 2, 520);
  const longFollowUp = synthesizeInteraction('swipe', longSession, 2, 2_700);
  assert.notDeepEqual(shortFollowUp, longFollowUp);
});

test('Akamai interaction policy separates joint swipe, tap and follow-up swipe', () => {
  const requestDriven = createInteractionPolicy('akamai-sensor');
  assert.equal(requestDriven(0, 0), null);
  assert.equal(requestDriven(10, 1), 'swipe');
  assert.equal(requestDriven(20, 1), null);
  assert.equal(requestDriven(30, 2), null);
  assert.equal(requestDriven(2_000, 20), null);
  assert.equal(requestDriven(2_499, 20), null);
  assert.equal(requestDriven(2_500, 20), 'tap');
  assert.equal(requestDriven(2_700, 20), 'swipe');
  assert.equal(requestDriven(3_200, 20), null);

  const fallback = createInteractionPolicy('akamai-sensor');
  assert.equal(fallback(119, 0), null);
  assert.equal(fallback(120, 0), 'swipe');
  assert.equal(fallback(449, 0), null);
  assert.equal(fallback(450, 0), null);
  assert.equal(fallback(2_000, 20), null);
  assert.equal(fallback(2_499, 20), null);
  assert.equal(fallback(2_500, 20), 'tap');
  assert.equal(fallback(2_700, 20), 'swipe');
  assert.equal(fallback(3_200, 20), null);
});

interface ObservedInputFields {
  readonly button: number | undefined;
  readonly buttons: number | undefined;
  readonly detail: number | undefined;
  readonly which: number | undefined;
  readonly pointerType: string | undefined;
}

interface ObservedEvent extends ObservedInputFields {
  readonly type: string;
  readonly constructor: string;
  readonly defaultPrevented: boolean;
}

const TAP_EVENT_TYPES = [
  'pointerover', 'pointerenter', 'pointerdown', 'pointerup', 'pointerout', 'pointerleave',
  'touchstart', 'touchend', 'mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click',
] as const;

async function observeTap(cancelType?: string): Promise<readonly ObservedEvent[]> {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const events: ObservedEvent[] = [];
  for (const type of TAP_EVENT_TYPES) {
    dom.window.document.addEventListener(type, (event) => {
      if (event.type === cancelType) event.preventDefault();
      const input = event as Event & ObservedInputFields;
      events.push({
        type: event.type,
        constructor: event.constructor.name,
        button: input.button,
        buttons: input.buttons,
        detail: input.detail,
        which: input.which,
        pointerType: input.pointerType,
        defaultPrevented: event.defaultPrevented,
      });
    }, { capture: true, passive: false });
  }
  const frames = synthesize('tap', `cancel-${cancelType ?? 'none'}`, 0);
  dom.window.eval(createInteractionSource(frames));
  const end = frames.at(-1)?.at ?? 0;
  await new Promise((resolve) => setTimeout(resolve, end + 30));
  dom.window.close();
  return events;
}

test('tap projects Chrome compatibility mouse ordering and cancellation', async () => {
  const [normal, pointerCanceled, touchStartCanceled, touchEndCanceled] = await Promise.all([
    observeTap(),
    observeTap('pointerdown'),
    observeTap('touchstart'),
    observeTap('touchend'),
  ]);
  assert.deepEqual(normal.map((event) => event.type), [
    'pointerover', 'pointerenter', 'pointerdown', 'touchstart',
    'pointerup', 'pointerout', 'pointerleave', 'touchend',
    'mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click',
  ]);
  assert.deepEqual(pointerCanceled.map((event) => event.type), [
    'pointerover', 'pointerenter', 'pointerdown', 'touchstart',
    'pointerup', 'pointerout', 'pointerleave', 'touchend',
    'mouseover', 'mouseenter', 'click',
  ]);
  assert.deepEqual(touchStartCanceled.map((event) => event.type), [
    'pointerover', 'pointerenter', 'pointerdown', 'touchstart',
    'pointerup', 'pointerout', 'pointerleave', 'touchend',
  ]);
  assert.deepEqual(touchEndCanceled.map((event) => event.type), touchStartCanceled.map((event) => event.type));

  const compatibilityEvents = normal.slice(-6);
  assert.deepEqual(compatibilityEvents.map((event) => event.constructor), [
    'MouseEvent', 'MouseEvent', 'MouseEvent', 'MouseEvent', 'MouseEvent', 'PointerEvent',
  ]);
  assert.deepEqual(compatibilityEvents.map((event) => [event.button, event.buttons, event.detail]), [
    [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1], [0, 0, 1],
  ]);
  assert.deepEqual(compatibilityEvents.map((event) => event.which), [0, 0, 0, 1, 1, 1]);
  assert.equal(compatibilityEvents.at(-1)?.pointerType, 'touch');
  assert.equal(pointerCanceled.find((event) => event.type === 'pointerdown')?.defaultPrevented, true);
  assert.equal(touchStartCanceled.find((event) => event.type === 'touchstart')?.defaultPrevented, true);
  assert.equal(touchEndCanceled.find((event) => event.type === 'touchend')?.defaultPrevented, true);
});
