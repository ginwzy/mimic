import { createMimic } from '../dist/src/public.js';
import { digest, seal } from '../dist/src/core/seal.js';
import { readFile } from 'node:fs/promises';
import { writeSync } from 'node:fs';

const RESULT_PREFIX = '__CEBU_CAPTURE_RESULT__';

function writeResult(value) {
  writeSync(process.stdout.fd, `${RESULT_PREFIX}${JSON.stringify(value)}`);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readInput() {
  const path = process.argv[2];
  if (path !== undefined) return JSON.parse(await readFile(path, 'utf8'));
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function requireString(input, name) {
  const value = input[name];
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function positiveInteger(value, fallback, name) {
  const output = value ?? fallback;
  if (!Number.isInteger(output) || output < 1) throw new TypeError(`${name} must be a positive integer`);
  return output;
}

/**
 * Abck multi-post harness (aligned with node_akamai init/events.js):
 * wrap XHR.send so each sensor POST schedules motion / touch sequences that
 * drive subsequent Akamai posts during the capture deadline window.
 */
function wrapAbckScript(scriptSource) {
  const prelude = String.raw`
;(function () {
  if (globalThis.__mimicAbckEvents) return;
  globalThis.__mimicAbckEvents = true;

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function motionEvent() {
    try {
      return new DeviceMotionEvent('devicemotion', {
        acceleration: {
          x: Number(rand(-0.2, 0.2).toFixed(2)),
          y: Number(rand(-0.2, 0.2).toFixed(2)),
          z: Number(rand(-0.2, 0.2).toFixed(2)),
        },
        accelerationIncludingGravity: {
          x: Number(rand(-0.5, 0.5).toFixed(2)),
          y: Number(rand(9.5, 10).toFixed(2)),
          z: Number(rand(-0.5, 0.5).toFixed(2)),
        },
        rotationRate: {
          alpha: Number(rand(-1, 1).toFixed(2)),
          beta: Number(rand(-1, 1).toFixed(2)),
          gamma: Number(rand(-1, 1).toFixed(2)),
        },
        interval: 16,
      });
    } catch (_error) {
      var fallback = new Event('devicemotion');
      try {
        Object.defineProperty(fallback, 'acceleration', {
          value: { x: 0.1, y: 0.1, z: 0.1 },
        });
        Object.defineProperty(fallback, 'accelerationIncludingGravity', {
          value: { x: 0.1, y: 9.8, z: 0.1 },
        });
        Object.defineProperty(fallback, 'rotationRate', {
          value: { alpha: 0, beta: 0, gamma: 0 },
        });
        Object.defineProperty(fallback, 'interval', { value: 16 });
      } catch (_defineError) {}
      return fallback;
    }
  }

  function orientationEvent(alpha, beta, gamma) {
    try {
      return new DeviceOrientationEvent('deviceorientation', {
        alpha: alpha,
        beta: beta,
        gamma: gamma,
        absolute: false,
      });
    } catch (_error) {
      var fallback = new Event('deviceorientation');
      try {
        Object.defineProperty(fallback, 'alpha', { value: alpha });
        Object.defineProperty(fallback, 'beta', { value: beta });
        Object.defineProperty(fallback, 'gamma', { value: gamma });
        Object.defineProperty(fallback, 'absolute', { value: false });
      } catch (_defineError) {}
      return fallback;
    }
  }

  async function triggerSensorStream(frames, stepMs) {
    frames = frames || 10;
    stepMs = stepMs || 20;
    var baseAlpha = 180 + rand(-20, 20);
    var baseBeta = 60 + rand(-10, 10);
    var baseGamma = rand(-5, 5);
    for (var i = 0; i < frames; i++) {
      window.dispatchEvent(motionEvent());
      window.dispatchEvent(orientationEvent(
        Number((baseAlpha + rand(-1, 1)).toFixed(1)),
        Number((baseBeta + rand(-1, 1)).toFixed(1)),
        Number((baseGamma + rand(-0.5, 0.5)).toFixed(1)),
      ));
      await wait(stepMs);
    }
  }

  function touchLike(type, x, y) {
    var point = { pageX: x, pageY: y, clientX: x, clientY: y, screenX: x, screenY: y, identifier: 1 };
    var touches = type === 'touchend' ? [] : [point];
    try {
      return new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: touches,
        targetTouches: touches,
        changedTouches: [point],
      });
    } catch (_error) {
      var event = new Event(type, { bubbles: true, cancelable: true });
      try {
        Object.defineProperty(event, 'touches', { value: touches });
        Object.defineProperty(event, 'targetTouches', { value: touches });
        Object.defineProperty(event, 'changedTouches', { value: [point] });
        Object.defineProperty(event, 'pageX', { value: x });
        Object.defineProperty(event, 'pageY', { value: y });
        Object.defineProperty(event, 'clientX', { value: x });
        Object.defineProperty(event, 'clientY', { value: y });
      } catch (_defineError) {}
      return event;
    }
  }

  function mouseLike(type, x, y) {
    try {
      return new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pageX: x,
        pageY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons: type === 'mouseup' ? 0 : 1,
      });
    } catch (_error) {
      var event = new Event(type, { bubbles: true, cancelable: true });
      try {
        Object.defineProperty(event, 'clientX', { value: x });
        Object.defineProperty(event, 'clientY', { value: y });
        Object.defineProperty(event, 'pageX', { value: x });
        Object.defineProperty(event, 'pageY', { value: y });
      } catch (_defineError) {}
      return event;
    }
  }

  async function triggerMixedSwipeSequence() {
    var startX = 250;
    var startY = 500;
    var endX = 250;
    var endY = 200;
    var steps = 10;
    var target = document;
    target.dispatchEvent(touchLike('touchstart', startX, startY));
    target.dispatchEvent(mouseLike('mousedown', startX, startY));
    await wait(rand(50, 100));
    for (var i = 1; i <= steps; i++) {
      var cx = startX + (endX - startX) * (i / steps) + rand(-2, 2);
      var cy = startY + (endY - startY) * (i / steps) + rand(-2, 2);
      target.dispatchEvent(touchLike('touchmove', cx, cy));
      target.dispatchEvent(mouseLike('mousemove', cx, cy));
      await wait(rand(10, 20));
    }
    await wait(rand(20, 50));
    target.dispatchEvent(touchLike('touchend', endX, endY));
    target.dispatchEvent(mouseLike('mouseup', endX, endY));
    // Extra mousemove bursts help CBl=11 path thresholds.
    for (var j = 0; j < 24; j++) {
      target.dispatchEvent(mouseLike('mousemove', endX + rand(-4, 4), endY + rand(-4, 4)));
      await wait(4);
    }
  }

  var xhrCount = 0;
  var nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    xhrCount += 1;
    var current = xhrCount;
    var result = nativeSend.apply(this, arguments);
    try {
      if (current === 1) {
        setTimeout(function () { triggerSensorStream().catch(function () {}); }, 0);
      } else if (current === 2) {
        setTimeout(function () { triggerMixedSwipeSequence().catch(function () {}); }, 0);
      } else {
        setTimeout(function () { triggerMixedSwipeSequence().catch(function () {}); }, 10);
      }
    } catch (_error) {}
    return result;
  };

  // Fallback schedules if the first post is delayed past load.
  setTimeout(function () { triggerSensorStream().catch(function () {}); }, 120);
  setTimeout(function () { triggerMixedSwipeSequence().catch(function () {}); }, 450);
  setTimeout(function () { triggerMixedSwipeSequence().catch(function () {}); }, 900);
  setTimeout(function () { triggerMixedSwipeSequence().catch(function () {}); }, 1500);
})();
`;
  return `${prelude}\n${scriptSource}`;
}

/**
 * BMS multi-id probe: log Object.assign batches whose keys look like sensor ids
 * (e.g. Ey### / iV###). After first XHR.send, emit a second probe POST body
 * `__BMS_ASSIGN__{...}` so capture can surface batches (maxPosts≥2).
 */
function wrapBmsProbe(scriptSource) {
  const prelude = String.raw`
;(function () {
  if (globalThis.__mimicBmsAssignProbe) return;
  globalThis.__mimicBmsAssignProbe = true;
  globalThis.__bmsAssignBatches = [];
  var nativeAssign = Object.assign;
  var batchIndex = 0;
  Object.assign = function (target) {
    var beforeKeys = -1;
    try {
      if (target && typeof target === 'object' && !Array.isArray(target)) {
        beforeKeys = Object.keys(target).length;
      }
    } catch (_b) {}
    var result = nativeAssign.apply(this, arguments);
    try {
      if (target && typeof target === 'object') {
        var keys = [];
        var sample = {};
        for (var i = 1; i < arguments.length; i++) {
          var src = arguments[i];
          if (!src || typeof src !== 'object') continue;
          var ks = Object.keys(src);
          for (var j = 0; j < ks.length; j++) {
            var k = ks[j];
            // Live: lD### / Ey### ; HAR-era: iV###
            if (/^[A-Za-z]{1,4}\d{2,4}$/.test(k)) {
              keys.push(k);
              if (Object.keys(sample).length < 8) {
                var v = src[k];
                var t = v === null ? 'null' : typeof v;
                sample[k] = t === 'string'
                  ? (v.length > 48 ? v.slice(0, 48) + '…' : v)
                  : t === 'number' || t === 'boolean' ? v : t;
              }
            }
          }
        }
        if (keys.length > 0) {
          batchIndex += 1;
          globalThis.__bmsAssignBatches.push({
            i: batchIndex,
            n: keys.length,
            beforeKeys: beforeKeys,
            afterKeys: Object.keys(target).filter(function (k) {
              return /^[A-Za-z]{1,4}\d{2,4}$/.test(k);
            }).length,
            isArray: Array.isArray(target),
            keys: keys.slice(0, 200),
            sample: sample,
          });
        }
      }
    } catch (_e) {}
    return result;
  };

  var dumped = false;
  var nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    var ret = nativeSend.apply(this, arguments);
    if (!dumped) {
      dumped = true;
      setTimeout(function () {
        try {
          var unique = {};
          var batches = globalThis.__bmsAssignBatches || [];
          for (var b = 0; b < batches.length; b++) {
            var ks = batches[b].keys || [];
            for (var t = 0; t < ks.length; t++) unique[ks[t]] = 1;
          }
          var payload = JSON.stringify({
            marker: '__BMS_ASSIGN__',
            batchCount: batches.length,
            uniqueKeys: Object.keys(unique).length,
            batches: batches,
          });
          var x = new XMLHttpRequest();
          x.open('POST', (location && location.origin ? location.origin : '') + '/__mimic_bms_assign__', true);
          x.send('__BMS_ASSIGN__' + payload);
        } catch (_e2) {}
      }, 30);
    }
    return ret;
  };
})();
`;
  return `${prelude}\n${scriptSource}`;
}

async function main() {
  const input = await readInput();
  const pageUrl = requireString(input, 'pageUrl');
  const pageHtml = requireString(input, 'pageHtml');
  const scriptUrl = requireString(input, 'scriptUrl');
  const scriptSource = requireString(input, 'scriptSource');
  const profile = requireString(input, 'profile');
  const cookies = Array.isArray(input.cookies) && input.cookies.every((item) => typeof item === 'string')
    ? input.cookies
    : [];
  const deadlineMs = positiveInteger(input.deadlineMs, 1_000, 'deadlineMs');
  const maxPosts = positiveInteger(input.maxPosts, 1, 'maxPosts');
  const scriptTimeoutMs = positiveInteger(input.scriptTimeoutMs, 8_000, 'scriptTimeoutMs');
  const events = input.events === 'abck' ? 'abck' : 'none';
  const material = { pageUrl, pageHtml, cookies, events };
  const page = seal({
    schema: 2,
    id: `cebu-www-${digest(material).slice(0, 16)}`,
    source: { kind: 'manual', hash: digest(material) },
    url: pageUrl,
    html: pageHtml,
    cookies,
  });
  // BMS dual-id table must come from runtime (script-specific Ey###/iV### maps);
  // do not inject HAR-derived iV pairs into live scripts (wrong prefix/ids).
  let code = scriptSource;
  if (events === 'abck') code = wrapAbckScript(scriptSource);
  else code = wrapBmsProbe(scriptSource);
  const mimic = createMimic({
    profile,
    page,
    size: 1,
    timeoutMs: scriptTimeoutMs + deadlineMs + 5_000,
    capture: { deadlineMs, pollMs: 10, maxPosts, lifecycle: 'auto' },
  });

  try {
    const result = await mimic.capture({
      kind: 'capture',
      code,
      scriptUrl,
      timeout: scriptTimeoutMs,
      trace: true,
    });
    if (!result.ok) {
      writeResult({ ok: false, error: result.error });
      process.exitCode = 1;
      return;
    }
    const value = result.value;
    const posts = value && typeof value === 'object' && Array.isArray(value.posts) ? value.posts : [];
    const allBodies = posts.flatMap((post) => (
      post && typeof post === 'object' && typeof post.body === 'string' && post.body.length > 0
        ? [post.body]
        : []
    ));
    let assignProbe = null;
    const bodies = [];
    for (const body of allBodies) {
      if (body.startsWith('__BMS_ASSIGN__')) {
        try {
          assignProbe = JSON.parse(body.slice('__BMS_ASSIGN__'.length));
        } catch (_e) {
          assignProbe = { parseError: true, rawLen: body.length };
        }
      } else {
        bodies.push(body);
      }
    }
    writeResult({
      ok: true,
      bodies,
      events,
      assignProbe,
      posts: posts.map((post) => ({
        via: post && typeof post === 'object' ? post.via : null,
        tag: post && typeof post === 'object' ? post.tag : null,
        len: post && typeof post === 'object' ? post.len : null,
      })),
    });
  } finally {
    await Promise.race([mimic.close(), delay(2_000)]);
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeResult({ ok: false, error: { message } });
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
