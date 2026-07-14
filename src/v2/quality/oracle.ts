import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createNodeApplication } from '../node/app.js';
import type { Application } from '../app/index.js';
import type { Data, JsonValue, Result } from '../core/types.js';

export interface IdentityObservation extends Data {
  userAgent: string;
  hasChrome: boolean;
  maxTouchPoints: number;
}

export interface ResultObservation extends Data {
  ok: boolean;
  missing: string[];
  value?: JsonValue;
  error?: string;
}

export interface TraceObservation extends Data {
  missing: string[];
  dynamicCode: number;
}

export interface CaptureObservation extends Data {
  syncCaptured: boolean;
  first: string | null;
  segments: Record<string, string>;
}

export interface V1Oracle {
  schema: number;
  behavior: {
    chrome: IdentityObservation;
    webview: IdentityObservation;
  };
  execution: {
    run: ResultObservation;
    throw: ResultObservation;
    timeout: ResultObservation;
    trace: TraceObservation;
    encode: ResultObservation;
    capture: CaptureObservation;
  };
}

export interface ApplicationOracle {
  schema: 2;
  behavior: {
    chrome: JsonValue;
    webview: JsonValue;
  };
  execution: {
    run: ResultObservation;
    throw: ResultObservation;
    timeout: ResultObservation;
    trace: TraceObservation;
    encode: ResultObservation;
    capture: CaptureObservation;
  };
}

export interface GoldenFailure extends Data {
  path: string;
  expected: JsonValue;
  actual: JsonValue;
}

export interface GoldenGate extends Data {
  ok: boolean;
  failures: GoldenFailure[];
}

const IDENTITY_CODE = `({
  userAgent: navigator.userAgent,
  hasChrome: Object.prototype.hasOwnProperty.call(window, 'chrome'),
  maxTouchPoints: navigator.maxTouchPoints
})`;

const CAPTURE_CODE = `
  (function(){ var x = new XMLHttpRequest(); x.open('POST','https://example.com/sync'); x.send('{"seg":"sync"}'); })();
  window.addEventListener('load', function(){
    var x = new XMLHttpRequest(); x.open('POST','https://example.com/load'); x.send('{"seg":"load"}');
    navigator.sendBeacon('https://example.com/beacon', '{"seg":"beacon"}');
    fetch('https://example.com/fetch', { method:'POST', body:'{"seg":"fetch"}' });
    setTimeout(function(){
      var x2 = new XMLHttpRequest(); x2.open('POST','https://example.com/timer'); x2.send('{"seg":"timer"}');
    }, 10);
  });
`;

function observedResult(result: Result): ResultObservation {
  return result.ok
    ? {
        ok: true,
        missing: [],
        ...(result.value === undefined ? {} : { value: result.value }),
      }
    : { ok: false, missing: [], error: result.error.message };
}

function failedObservation(message: string): Data {
  return { ok: false, error: message };
}

async function identity(application: Application, profile: string): Promise<JsonValue> {
  const result = await application.execute({ profile, job: { kind: 'run', code: IDENTITY_CODE } });
  return result.ok && result.value !== undefined
    ? result.value
    : failedObservation(result.ok ? 'identity returned no value' : result.error.message);
}

function traceOf(result: Result): TraceObservation {
  const raw = result.report?.trace;
  const trace = raw !== null && !Array.isArray(raw) && typeof raw === 'object' ? raw as Data : {};
  const missing = Array.isArray(trace.missing)
    ? trace.missing.filter((value): value is string => typeof value === 'string')
    : [];
  return {
    missing,
    dynamicCode: Array.isArray(trace.dynamicCode) ? trace.dynamicCode.length : 0,
  };
}

function segment(body: string | null | undefined): string | null {
  if (body === null || body === undefined) return null;
  try {
    const value: unknown = JSON.parse(body);
    if (value !== null && !Array.isArray(value) && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      return typeof item.seg === 'string' ? item.seg : null;
    }
  } catch {
    // Non-JSON bodies cannot identify a golden segment.
  }
  return null;
}

function captureOf(result: Result): CaptureObservation {
  const raw = result.ok ? result.value : undefined;
  const value = raw !== null && !Array.isArray(raw) && typeof raw === 'object' ? raw as Data : {};
  const posts = Array.isArray(value.posts) ? value.posts : [];
  const segments: Record<string, string> = {};
  for (const rawPost of posts) {
    if (rawPost === null || Array.isArray(rawPost) || typeof rawPost !== 'object') continue;
    const post = rawPost as Data;
    const name = segment(typeof post.body === 'string' ? post.body : null);
    if (name !== null && segments[name] === undefined && typeof post.via === 'string') segments[name] = post.via;
  }
  return {
    syncCaptured: value.syncCaptured === true,
    first: segment(typeof value.captured === 'string' ? value.captured : null),
    segments,
  };
}

export async function collectApplicationOracle(application: Application): Promise<ApplicationOracle> {
  const [chrome, webview] = await Promise.all([
    identity(application, 'chrome-mac'),
    identity(application, 'android-webview-v138'),
  ]);
  const run = await application.execute({ profile: 'chrome-mac', job: { kind: 'run', code: '1 + 1' } });
  const thrown = await application.execute({
    profile: 'chrome-mac',
    job: { kind: 'run', code: 'throw new Error("oracle boom")' },
  });
  const timeout = await application.execute({
    profile: 'chrome-mac',
    job: { kind: 'run', code: 'while (true) {}', timeout: 10 },
  });
  const traced = await application.execute({
    profile: 'chrome-mac',
    job: { kind: 'diagnose', code: `eval('1 + 2'); OracleMissing.value` },
  });
  const encoded = await application.execute({ profile: 'chrome-mac', job: { kind: 'run', code: 'window' } });
  const captured = await application.execute({
    profile: 'chrome-mac',
    job: {
      kind: 'capture',
      code: CAPTURE_CODE,
      scriptUrl: 'https://example.com/oracle.js',
    },
  });

  return {
    schema: 2,
    behavior: { chrome, webview },
    execution: {
      run: observedResult(run),
      throw: observedResult(thrown),
      timeout: observedResult(timeout),
      trace: traceOf(traced),
      encode: observedResult(encoded),
      capture: captureOf(captured),
    },
  };
}

export function evaluateGoldenOracle(expected: V1Oracle, actual: ApplicationOracle): GoldenGate {
  const pairs: Array<[string, JsonValue, JsonValue]> = [
    ['behavior.chrome', expected.behavior.chrome, actual.behavior.chrome],
    ['behavior.webview', expected.behavior.webview, actual.behavior.webview],
    ['execution.run', expected.execution.run, actual.execution.run],
    ['execution.throw', expected.execution.throw, actual.execution.throw],
    ['execution.timeout', expected.execution.timeout, actual.execution.timeout],
    ['execution.trace', expected.execution.trace, actual.execution.trace],
    ['execution.encode', expected.execution.encode, actual.execution.encode],
    ['execution.capture', expected.execution.capture, actual.execution.capture],
  ];
  const failures = pairs
    .filter(([, wanted, observed]) => !isDeepStrictEqual(wanted, observed))
    .map(([path, wanted, observed]) => ({ path, expected: wanted, actual: observed }));
  return { ok: failures.length === 0, failures };
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

const direct = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const baseline = path.resolve(flag('baseline') ?? 'resources/v2/oracles/v1.json');
  const profilesRoot = flag('profiles-root');
  const probePath = flag('probe-path');
  try {
    const expected = JSON.parse(await readFile(baseline, 'utf8')) as V1Oracle;
    const application = createNodeApplication({
      ...(profilesRoot === undefined ? {} : { profilesRoot }),
      ...(probePath === undefined ? {} : { probePath }),
      capture: { deadlineMs: 1_000, pollMs: 5, maxPosts: 5 },
    });
    const observation = await collectApplicationOracle(application);
    const gate = evaluateGoldenOracle(expected, observation);
    console.log(JSON.stringify({
      schema: 2,
      baseline: path.relative(process.cwd(), baseline),
      observation,
      gate,
    }));
    if (!gate.ok) process.exitCode = 1;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.log(JSON.stringify({
      schema: 2,
      baseline: path.relative(process.cwd(), baseline),
      gate: {
        ok: false,
        failures: [{ path: 'oracle', expected: 'completed observation', actual: message }],
      },
    }));
    process.exitCode = 1;
  }
}
