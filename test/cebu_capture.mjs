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
  globalThis.__bmsSwLog = [];
  // Non-invasive SharedWorker spy (preserve constructor.name === "SharedWorker").
  try {
    var NativeSW = globalThis.SharedWorker;
    globalThis.__bmsSwLog.push({
      t: 'gate',
      present: typeof NativeSW === 'function',
      name: NativeSW && NativeSW.prototype && NativeSW.prototype.constructor
        ? NativeSW.prototype.constructor.name
        : null,
    });
    if (typeof NativeSW === 'function') {
      var SpySW = function SharedWorker(url, opts) {
        globalThis.__bmsSwLog.push({ t: 'construct', url: String(url).slice(0, 96) });
        var sw = opts !== undefined ? new NativeSW(url, opts) : new NativeSW(url);
        try {
          var port = sw.port;
          var start = port.start;
          if (typeof start === 'function') {
            port.start = function () {
              globalThis.__bmsSwLog.push({ t: 'port.start' });
              return start.call(port);
            };
          }
          var desc = Object.getOwnPropertyDescriptor(port, 'onmessage');
          var setOn = function (fn) {
            globalThis.__bmsSwLog.push({ t: 'port.onmessage.set', isFn: typeof fn === 'function' });
            var wrapped = typeof fn === 'function' ? function (ev) {
              try {
                var d = ev && ev.data;
                globalThis.__bmsSwLog.push({
                  t: 'port.message',
                  status: d && typeof d === 'object' ? d.status : undefined,
                  topKeys: d && typeof d === 'object' ? Object.keys(d).slice(0, 12) : null,
                  dataKeys: d && d.data && typeof d.data === 'object' ? Object.keys(d.data).slice(0, 24) : null,
                });
              } catch (_e) {}
              return fn.apply(this, arguments);
            } : fn;
            if (desc && typeof desc.set === 'function') desc.set.call(port, wrapped);
            else {
              // Fall back: assign may use data property
              try { port.onmessage = wrapped; } catch (_e2) {}
            }
          };
          if (desc && desc.configurable) {
            Object.defineProperty(port, 'onmessage', {
              configurable: true,
              enumerable: true,
              get: desc.get ? function () { return desc.get.call(port); } : function () { return null; },
              set: setOn,
            });
          }
        } catch (e) {
          globalThis.__bmsSwLog.push({ t: 'spy-error', err: String(e && e.message || e) });
        }
        return sw;
      };
      SpySW.prototype = NativeSW.prototype;
      try {
        Object.defineProperty(SpySW, 'name', { value: 'SharedWorker' });
        Object.defineProperty(SpySW, 'prototype', { value: NativeSW.prototype });
      } catch (_n) {}
      // Critical: BMS checks SharedWorker.prototype.constructor.name
      try { NativeSW.prototype.constructor = SpySW; } catch (_c) {}
      globalThis.SharedWorker = SpySW;
    }
  } catch (e0) {
    globalThis.__bmsSwLog.push({ t: 'gate-error', err: String(e0 && e0.message || e0) });
  }
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
            swLog: globalThis.__bmsSwLog || [],
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
  const interactionSeed = events === 'abck' ? requireString(input, 'interactionSeed') : undefined;
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
  const code = events === 'abck' ? scriptSource : wrapBmsProbe(scriptSource);
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
      ...(events === 'abck' ? {
        interaction: { adapter: 'akamai-sensor', seed: interactionSeed },
      } : {}),
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
