import type { InteractionAdapter } from '../core/types.js';
import type { InteractionPolicy } from './types.js';

const NONE: InteractionPolicy = () => null;

function createAkamaiSensorPolicy(): InteractionPolicy {
  let motionDispatched = false;
  let swipeDispatched = false;
  return (elapsedMs, postCount) => {
    if (!motionDispatched && (postCount > 0 || elapsedMs >= 120)) {
      motionDispatched = true;
      return 'motion-burst';
    }
    if (!swipeDispatched && motionDispatched && (postCount > 1 || elapsedMs >= 450)) {
      swipeDispatched = true;
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
