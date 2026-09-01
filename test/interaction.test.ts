import assert from 'node:assert/strict';
import test from 'node:test';
import { CSD4CA_MODEL } from '../src/interaction/csd4ca.model.js';
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

  assert.deepEqual(repeated, first);
  assert.notDeepEqual(changed, first);
  assert.ok(first.length > 0);
  let previousAt = 0;
  for (const frame of first) {
    assert.ok(frame.at >= previousAt);
    previousAt = frame.at;
    if (frame.kind === 'touch' || frame.kind === 'mouse') {
      assert.ok(frame.x >= 0 && frame.x <= 1);
      assert.ok(frame.y >= 0 && frame.y <= 1);
    }
  }
  const touches = first.filter((frame) => frame.kind === 'touch');
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
});

test('Akamai interaction policy fires one motion burst and one swipe', () => {
  const requestDriven = createInteractionPolicy('akamai-sensor');
  assert.equal(requestDriven(0, 0), null);
  assert.equal(requestDriven(10, 1), 'motion-burst');
  assert.equal(requestDriven(20, 1), null);
  assert.equal(requestDriven(30, 2), 'swipe');
  assert.equal(requestDriven(2_000, 20), null);

  const fallback = createInteractionPolicy('akamai-sensor');
  assert.equal(fallback(119, 0), null);
  assert.equal(fallback(120, 0), 'motion-burst');
  assert.equal(fallback(449, 0), null);
  assert.equal(fallback(450, 0), 'swipe');
  assert.equal(fallback(2_000, 20), null);
});
