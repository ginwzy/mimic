import type { InteractionAdapter } from '../core/types.js';
import { sampleSwipeGap, type InteractionSession } from './synthesize.js';
import type { InteractionPolicy } from './types.js';

const FOLLOW_UP_LIMIT_MS = 2_700;
// Tap remains an engineering recipe, with room for its maximum 130ms contact.
const TAP_LEAD_MS = 200;

const NONE: InteractionPolicy = Object.freeze({
  next: () => null,
  isExhausted: () => true,
});

function createAkamaiSensorPolicy(session: InteractionSession): InteractionPolicy {
  let initialSwipeAt: number | undefined;
  let followUpAt: number | undefined;
  let tapDispatched = false;
  let followUpDispatched = false;
  return {
    next: (elapsedMs, postCount, latestInteractionEndAt) => {
      if (initialSwipeAt === undefined) {
        const canStart = postCount > 0 || elapsedMs >= 120;
        if (!canStart) return null;
        initialSwipeAt = elapsedMs;
        return 'swipe';
      }
      if (followUpAt === undefined) {
        const gap = sampleSwipeGap(
          session,
          latestInteractionEndAt - initialSwipeAt + TAP_LEAD_MS,
          FOLLOW_UP_LIMIT_MS - initialSwipeAt,
        );
        // An empty source window retains the old engineering schedule, without clipping source gaps.
        followUpAt = gap === null ? FOLLOW_UP_LIMIT_MS : initialSwipeAt + gap;
      }
      if (elapsedMs < latestInteractionEndAt) return null;
      if (!tapDispatched && elapsedMs >= followUpAt - TAP_LEAD_MS) {
        tapDispatched = true;
        return 'tap';
      }
      if (!followUpDispatched && elapsedMs >= followUpAt) {
        followUpDispatched = true;
        return 'swipe';
      }
      return null;
    },
    isExhausted: () => followUpDispatched,
  };
}

export function createInteractionPolicy(adapter: InteractionAdapter, session: InteractionSession): InteractionPolicy {
  if (adapter === 'none') return NONE;
  if (adapter === 'akamai-sensor') return createAkamaiSensorPolicy(session);
  const unreachable: never = adapter;
  throw new TypeError(`Unknown interaction adapter:${String(unreachable)}`);
}
