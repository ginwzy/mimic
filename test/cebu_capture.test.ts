import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const RESULT_PREFIX = '__CEBU_CAPTURE_RESULT__';

interface BridgeResult {
  readonly ok: boolean;
  readonly events?: string;
  readonly bodies?: string[];
  readonly error?: unknown;
}

function runBridge(input: object): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('test/cebu_capture.mjs')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const marker = stdout.lastIndexOf(RESULT_PREFIX);
      if (code !== 0 || marker < 0) {
        reject(new Error(`cebu_capture exited ${code ?? signal}: ${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(stdout.slice(marker + RESULT_PREFIX.length)) as BridgeResult);
    });
    child.stdin.end(JSON.stringify(input));
  });
}

test('ANA/Cebu bridge forwards independent seeds to the model-backed ABCK adapter', { timeout: 15_000 }, async () => {
  const input = {
    pageUrl: 'https://example.test/booking',
    pageHtml: '<!doctype html><html><body></body></html>',
    scriptUrl: 'https://example.test/akamai.js',
    scriptSource: `(() => {
      const post = body => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/sensor');
        xhr.send(body);
      };
      addEventListener('devicemotion', event => post(JSON.stringify({
        kind: 'motion',
        trusted: event.isTrusted,
        acceleration: event.acceleration,
      })), { once: true });
      document.addEventListener('touchstart', event => {
        const point = event.changedTouches[0];
        post(JSON.stringify({
          kind: 'touch',
          trusted: event.isTrusted,
          touchInstance: point instanceof Touch,
          clientX: point.clientX,
          clientY: point.clientY,
          radiusX: point.radiusX,
          radiusY: point.radiusY,
          force: point.force,
        }));
      }, { once: true });
      post('initial');
    })()`,
    profile: 'android-webview-v138',
    cookies: [],
    deadlineMs: 2_000,
    maxPosts: 3,
    scriptTimeoutMs: 5_000,
    events: 'abck',
  };
  const [result, otherResult] = await Promise.all([
    runBridge({ ...input, interactionSeed: 'flow-seed-a' }),
    runBridge({ ...input, interactionSeed: 'flow-seed-b' }),
  ]);

  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(otherResult.ok, true, JSON.stringify(otherResult.error));
  assert.equal(result.events, 'abck');
  assert.ok(result.bodies);
  assert.equal(result.bodies[0], 'initial');
  const reports = result.bodies.slice(1).map((body) => JSON.parse(body) as Record<string, unknown>);
  const motion = reports.find((report) => report.kind === 'motion');
  const touch = reports.find((report) => report.kind === 'touch');
  assert.equal(motion?.trusted, true);
  assert.equal(typeof (motion?.acceleration as { x?: unknown } | undefined)?.x, 'number');
  assert.deepEqual([touch?.trusted, touch?.touchInstance], [true, true]);
  assert.ok((touch?.radiusX as number) > 0);
  assert.ok((touch?.radiusY as number) > 0);
  assert.ok((touch?.force as number) >= 0 && (touch?.force as number) <= 1);
  assert.ok(otherResult.bodies);
  const otherTouch = otherResult.bodies
    .slice(1)
    .map((body) => JSON.parse(body) as Record<string, unknown>)
    .find((report) => report.kind === 'touch');
  assert.notDeepEqual(touch, otherTouch);
});
