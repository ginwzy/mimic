import type { InteractionAdapter } from '../core/types.js';
import type { InteractionPolicy } from './types.js';

const NONE: InteractionPolicy = () => null;

function createAkamaiSensorPolicy(): InteractionPolicy {
  let motionDispatched = false;
  let initialSwipeDispatched = false;
  let tapDispatched = false;
  let followUpDispatched = false;
  return (elapsedMs, postCount) => {
    if (!motionDispatched && (postCount > 0 || elapsedMs >= 120)) {
      motionDispatched = true;
      return 'motion-burst';
    }
    if (!initialSwipeDispatched && motionDispatched && (postCount > 1 || elapsedMs >= 450)) {
      initialSwipeDispatched = true;
      return 'swipe';
    }
    // The longest compiled swipe is 1968ms; keep contacts from overlapping.
    if (!tapDispatched && initialSwipeDispatched && elapsedMs >= 2_500) {
      tapDispatched = true;
      return 'tap';
    }
    if (!followUpDispatched && tapDispatched && elapsedMs >= 2_900) {
      followUpDispatched = true;
      return 'swipe';
    }
    return null;
  };
}

export function createInteractionPolicy(adapter: InteractionAdapter): InteractionPolicy {
  if (adapter === 'none') return NONE;
  if (adapter === 'akamai-sensor') return createAkamaiSensorPolicy();
  const unreachable: never = adapter;
  throw new TypeError(`Unknown interaction adapter:${String(unreachable)}`);
}
