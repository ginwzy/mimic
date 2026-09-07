import { MimicError } from '../core/error.js';
import { captureReport, type CaptureValue, type NetReport } from '../core/capture.js';
import type { Data } from '../core/types.js';
import type { Runtime } from '../engine/types.js';
import { createInteractionSource } from '../interaction/dispatch.js';
import { createInteractionPolicy } from '../interaction/policies.js';
import { createInteractionSession, synthesizeInteraction } from '../interaction/synthesize.js';
import { executeScript } from './script.js';
import type { CapturePolicy, ScriptPolicy } from './task.js';

const LIFECYCLE = `(() => {
  const fire = (target, type, bubbles = false) => {
    try { target.dispatchEvent(new Event(type, { bubbles })); } catch {}
  };
  // jsdom often leaves readyState at "loading" after HTML inject; Chrome is "complete"
  // once load has fired. BMS / abck gate probes on readyState + hasFocus.
  try {
    if (document.readyState !== 'complete') {
      Object.defineProperty(document, 'readyState', {
        configurable: true, enumerable: true, get: () => 'complete',
      });
      fire(document, 'readystatechange');
      fire(document, 'DOMContentLoaded', true);
      fire(window, 'load');
    }
  } catch {}
  try {
    // Focused top-level browsing context (default for real page load).
    Document.prototype.hasFocus = function hasFocus() { return true; };
  } catch {}
  fire(window, 'pageshow');
})()`;

const delay = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));
const nonEmptyPostCount = (report: NetReport): number => report.posts.filter(post => post.len > 0).length;

/** Owns capture lifecycle and completion; the task runner owns Realm disposal. */
export class CaptureSession {
  constructor(
    private readonly runtime: Runtime,
    private readonly policy: CapturePolicy,
    private readonly script: ScriptPolicy,
  ) {}

  async run(code: string): Promise<{ value: CaptureValue; report: Data }> {
    const { runtime, policy, script } = this;
    const timeout = script.timeoutMs === null ? {} : { timeout: script.timeoutMs };
    if (policy.lifecycle === 'auto') {
      const lifecycle = runtime.run(LIFECYCLE, timeout);
      if (!lifecycle.ok) {
        throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: lifecycle.error, plan: runtime.plan.id });
      }
    }
    executeScript(runtime, code, script);
    const before = captureReport(runtime.report());
    await delay(0);
    const started = Date.now();
    let current = captureReport(runtime.report());
    const adapter = policy.interaction.adapter;
    const interaction = createInteractionPolicy(adapter);
    const interactionSession = createInteractionSession(policy.interaction.seed);
    let interactionSequence = 0;
    let pageOffsetYRatio = 0;
    let postCount = nonEmptyPostCount(current);
    let lastPostObservedAt = 0;
    let latestInteractionEndAt = 0;
    while (Date.now() - started < policy.deadlineMs
      && (postCount < policy.maxPosts || (current.pending ?? 0) > 0)) {
      const elapsed = Date.now() - started;
      const action = postCount < policy.maxPosts ? interaction.next(elapsed, postCount) : null;
      if (action !== null) {
        const frames = synthesizeInteraction(action.recipe, interactionSession, interactionSequence++, action.plannedAtMs);
        const dispatchResult = runtime.run(
          createInteractionSource(frames, pageOffsetYRatio),
          { ...timeout, trustedEvents: true },
        );
        if (!dispatchResult.ok) {
          throw new MimicError({
            phase: 'run',
            code: 'RUN_FAILED',
            message: `Interaction dispatch failed:${dispatchResult.error}`,
            plan: runtime.plan.id,
          });
        }
        latestInteractionEndAt = Math.max(
          latestInteractionEndAt,
          Date.now() - started + frames.at(-1)!.at,
        );
        if (action.recipe === 'swipe' && !runtime.plan.boot.layout) {
          // Track planned upward displacement for subsequent recipes.
          const touchFrames = frames.filter((frame) => frame.kind === 'touch');
          const firstTouch = touchFrames[0]!;
          const lastTouch = touchFrames.at(-1)!;
          pageOffsetYRatio += Math.max(0, firstTouch.y - lastTouch.y);
        }
      }
      await delay(policy.pollMs);
      current = captureReport(runtime.report());
      const observedAt = Date.now() - started;
      const observedPostCount = nonEmptyPostCount(current);
      if (observedPostCount !== postCount) {
        postCount = observedPostCount;
        lastPostObservedAt = observedAt;
      }
      const settleAfter = Math.max(
        latestInteractionEndAt,
        lastPostObservedAt,
        policy.completion.minimumInteractionMs,
      ) + policy.completion.quietMs;
      if (adapter !== 'none'
        && (current.pending ?? 0) === 0
        && interaction.isExhausted()
        && observedAt >= settleAfter) break;
    }
    if ((current.pending ?? 0) > 0) {
      throw new Error('Capture deadline expired with pending network requests');
    }
    const report = runtime.report();
    const value: CaptureValue = {
      syncCaptured: before.posts.some((post) => post.len > 0),
      captured: current.body,
      posts: current.posts,
    };
    return { value, report };
  }
}
