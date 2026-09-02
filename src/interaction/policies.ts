import type { InteractionAdapter } from '../core/types.js';
import type { InteractionPolicy } from './types.js';

const NONE: InteractionPolicy = () => null;

function createAkamaiSensorPolicy(): InteractionPolicy {
  let initialSwipeDispatched = false;
  let tapDispatched = false;
  let followUpDispatched = false;
  return (elapsedMs, postCount) => {
    if (!initialSwipeDispatched && (postCount > 0 || elapsedMs >= 120)) {
      initialSwipeDispatched = true;
      return 'swipe';
    }
    // Calibrated sensor lead can delay touch by 150ms; keep contacts from overlapping.
    if (!tapDispatched && initialSwipeDispatched && elapsedMs >= 2_500) {
      tapDispatched = true;
      return 'tap';
    }
    if (!followUpDispatched && tapDispatched && elapsedMs >= 2_700) {
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
