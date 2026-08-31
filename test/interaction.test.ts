import assert from 'node:assert/strict';
import test from 'node:test';
import { createInteractionPolicy } from '../src/interaction/policies.js';
import { synthesizeInteraction } from '../src/interaction/synthesize.js';

test('interaction synthesis is seeded, bounded and time ordered', () => {
  const first = synthesizeInteraction('swipe', 'seed-a', 0);
  const repeated = synthesizeInteraction('swipe', 'seed-a', 0);
  const changed = synthesizeInteraction('swipe', 'seed-b', 0);

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
