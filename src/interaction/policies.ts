import type { InteractionAdapter } from '../core/types.js';
import type { InteractionPolicy } from './types.js';

const NONE: InteractionPolicy = Object.freeze({
  next: () => null,
  isExhausted: () => true,
});

function createAkamaiSensorPolicy(): InteractionPolicy {
  let initialSwipeDispatched = false;
  let tapDispatched = false;
  let followUpDispatched = false;
  return {
    next: (elapsedMs, postCount) => {
      if (!initialSwipeDispatched && (postCount > 0 || elapsedMs >= 120)) {
        initialSwipeDispatched = true;
        return { recipe: 'swipe', plannedAtMs: 120 };
      }
      // Calibrated sensor lead can delay touch by 150ms; keep contacts from overlapping.
      if (!tapDispatched && initialSwipeDispatched && elapsedMs >= 2_500) {
        tapDispatched = true;
        return { recipe: 'tap', plannedAtMs: 2_500 };
      }
      if (!followUpDispatched && tapDispatched && elapsedMs >= 2_700) {
        followUpDispatched = true;
        return { recipe: 'swipe', plannedAtMs: 2_700 };
      }
      return null;
    },
    isExhausted: () => followUpDispatched,
  };
}

export function createInteractionPolicy(adapter: InteractionAdapter): InteractionPolicy {
  if (adapter === 'none') return NONE;
  if (adapter === 'akamai-sensor') return createAkamaiSensorPolicy();
  const unreachable: never = adapter;
  throw new TypeError(`Unknown interaction adapter:${String(unreachable)}`);
}
