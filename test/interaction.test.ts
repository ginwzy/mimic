import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { CSD4CA_MODEL } from '../src/interaction/csd4ca.model.js';
import { createInteractionSource } from '../src/interaction/dispatch.js';
import { createInteractionPolicy } from '../src/interaction/policies.js';
import { synthesizeInteraction } from '../src/interaction/synthesize.js';

test('CSD4CA interaction model is anonymous, compact and structurally complete', () => {
  assert.equal(CSD4CA_MODEL.schema, 1);
  assert.equal(CSD4CA_MODEL.frames, 16);
  assert.equal(CSD4CA_MODEL.stride, 18);
  assert.equal(CSD4CA_MODEL.source.license, 'CC-BY-4.0');
  assert.equal(CSD4CA_MODEL.source.doi, '10.5281/zenodo.17931118');
  assert.equal(CSD4CA_MODEL.groups.length, 6);
  assert.equal(CSD4CA_MODEL.groups.reduce((sum, group) => sum + group.count, 0), 21_780);
  for (const group of CSD4CA_MODEL.groups) {
    assert.equal(group.direction, 'up');
    assert.equal(group.mean.length, CSD4CA_MODEL.frames * CSD4CA_MODEL.stride);
    assert.equal(group.components.length, 4);
    assert.ok(group.components.every((component) => component.basis.length === group.mean.length));
  }
});

test('interaction synthesis is model-backed, seeded, bounded and time ordered', () => {
  const first = synthesizeInteraction('swipe', 'seed-a', 0);
  const repeated = synthesizeInteraction('swipe', 'seed-a', 0);
  const changed = synthesizeInteraction('swipe', 'seed-b', 0);
  const motion = synthesizeInteraction('motion-burst', 'seed-a', 0);
  const tap = synthesizeInteraction('tap', 'seed-a', 0);

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
  assert.equal(first.length, CSD4CA_MODEL.frames);
  assert.equal(touches.length, CSD4CA_MODEL.frames);
  assert.deepEqual([touches[0]?.phase, touches.at(-1)?.phase], ['start', 'end']);
  assert.ok(touches[0]!.y - touches.at(-1)!.y >= 0.08);
  assert.ok(touches.every((frame) => frame.radiusX > 0 && frame.radiusY > 0));
  assert.ok(touches.every((frame) => frame.force >= 0 && frame.force <= 1));

  const motions = motion.filter((frame) => frame.kind === 'motion');
  const orientations = motion.filter((frame) => frame.kind === 'orientation');
  assert.equal(motions.length, CSD4CA_MODEL.frames);
  assert.equal(orientations.length, CSD4CA_MODEL.frames);
  assert.ok(motions.every((frame) => frame.interval >= 12 && frame.interval <= 27));
  assert.ok(motions.every((frame) => [...frame.acceleration, ...frame.gravity, ...frame.rotation].every(Number.isFinite)));

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

test('Akamai interaction policy separates motion, swipe, tap and follow-up swipe', () => {
  const requestDriven = createInteractionPolicy('akamai-sensor');
  assert.equal(requestDriven(0, 0), null);
  assert.equal(requestDriven(10, 1), 'motion-burst');
  assert.equal(requestDriven(20, 1), null);
  assert.equal(requestDriven(30, 2), 'swipe');
  assert.equal(requestDriven(2_000, 20), null);
  assert.equal(requestDriven(2_500, 20), 'tap');
  assert.equal(requestDriven(2_900, 20), 'swipe');
  assert.equal(requestDriven(3_000, 20), null);

  const fallback = createInteractionPolicy('akamai-sensor');
  assert.equal(fallback(119, 0), null);
  assert.equal(fallback(120, 0), 'motion-burst');
  assert.equal(fallback(449, 0), null);
  assert.equal(fallback(450, 0), 'swipe');
  assert.equal(fallback(2_000, 20), null);
  assert.equal(fallback(2_500, 20), 'tap');
  assert.equal(fallback(2_900, 20), 'swipe');
  assert.equal(fallback(3_000, 20), null);
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
  const frames = synthesizeInteraction('tap', `cancel-${cancelType ?? 'none'}`, 0);
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
