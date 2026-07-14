import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createNodeApplication, JsdomEngine } from '../src/index.js';
import { drivers } from '../src/features/index.js';

const profilesRoot = path.resolve('profiles');
const probePath = path.resolve('resources/probe.js');
const cwd = process.cwd();

const forbiddenStackFragments = [
  'node:',
  'file:',
  cwd,
  'node_modules/jsdom',
  'node_modules\\jsdom',
  'dist',
  'build/test',
  'build\\test',
];

function assertPublicStack(stack: unknown, name: string, message: string): asserts stack is string {
  if (typeof stack !== 'string') assert.fail(`expected stack string, received ${typeof stack}`);
  assert.match(stack, new RegExp(`^${name}: ${message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(stack, /https:\/\/user\.example\/security-stack\.js:\d+:\d+/);
  for (const fragment of forbiddenStackFragments) {
    assert.equal(stack.includes(fragment), false, `stack leaked ${fragment}:\n${stack}`);
  }
}

function application() {
  const engine = new JsdomEngine();
  return {
    app: createNodeApplication({ engine, profilesRoot, probePath }),
    engine,
  };
}

test('Runtime sanitizes a synchronous Error stack at the public execution boundary', async () => {
  const { app, engine } = application();
  const plan = await app.plan({
    profile: 'android-webview-v138',
    job: {
      kind: 'run',
      code: 'throw new TypeError("sync boom")',
      scriptUrl: 'https://user.example/security-stack.js',
    },
  });
  const runtime = engine.open(plan, drivers);
  try {
    const result = runtime.run('throw new TypeError("sync boom")', {
      url: 'https://user.example/security-stack.js',
    });
    assert.equal(result.ok, false);
    if (result.ok) assert.fail('expected Runtime failure');
    assert.equal(result.error, 'sync boom');
    assertPublicStack(result.stack, 'TypeError', 'sync boom');
  } finally {
    runtime.dispose();
  }
});

test('Application returns sanitized event and Promise Error stacks with user frames intact', async () => {
  const { app, engine } = application();
  const result = await app.execute({
    profile: 'android-webview-v138',
    job: {
      kind: 'run',
      scriptUrl: 'https://user.example/security-stack.js',
      code: `(() => {
        let eventStack = '';
        addEventListener('mimic-security-stack', () => {
          eventStack = new RangeError('event boom').stack;
        }, { once: true });
        dispatchEvent(new Event('mimic-security-stack'));

        let promiseStack = '';
        new Promise(() => {
          promiseStack = new Error('promise boom').stack;
        });
        return { eventStack, promiseStack };
      })()`,
    },
  });

  assert.equal(result.ok, true);
  const value = result.value as { eventStack?: unknown; promiseStack?: unknown };
  assertPublicStack(value.eventStack, 'RangeError', 'event boom');
  assertPublicStack(value.promiseStack, 'Error', 'promise boom');
  assert.equal(engine.active, 0);
});

test('Runtime sanitizes Error stacks created in a Promise microtask', async () => {
  const { app, engine } = application();
  const plan = await app.plan({
    profile: 'android-webview-v138',
    job: {
      kind: 'run',
      code: 'Promise.resolve().then(() => new Error("microtask boom").stack)',
      scriptUrl: 'https://user.example/security-stack.js',
    },
  });
  const runtime = engine.open(plan, drivers);
  try {
    const result = runtime.run('Promise.resolve().then(() => new Error("microtask boom").stack)', {
      url: 'https://user.example/security-stack.js',
    });
    assert.equal(result.ok, true);
    const stack = await result.value;
    assertPublicStack(stack, 'Error', 'microtask boom');
  } finally {
    runtime.dispose();
  }
});

test('Application hides jsdom implementation Symbols from browser-facing objects', async () => {
  const { app, engine } = application();
  const result = await app.execute({
    profile: 'android-webview-v138',
    job: {
      kind: 'run',
      code: `(() => {
        const div = document.createElement('div');
        const descriptions = value => Object.getOwnPropertySymbols(value).map(symbol => symbol.description ?? '');
        return {
          window: descriptions(window),
          document: descriptions(document),
          div: descriptions(div),
          navigator: descriptions(navigator),
          reflectWindow: Reflect.ownKeys(window)
            .filter(key => typeof key === 'symbol')
            .map(symbol => symbol.description ?? ''),
          nonConfigurableProxy: (() => {
            const target = {};
            Object.defineProperty(target, Symbol('impl'), { value: true, configurable: false });
            return Reflect.ownKeys(new Proxy(target, {}))
              .filter(key => typeof key === 'symbol')
              .map(symbol => symbol.description ?? '');
          })(),
        };
      })()`,
    },
  });

  assert.equal(result.ok, true);
  const surfaces = result.value as Record<string, string[]>;
  const { nonConfigurableProxy, ...browserSurfaces } = surfaces;
  for (const [surface, descriptions] of Object.entries(browserSurfaces)) {
    assert.equal(
      descriptions.some((description) => /webidl2js|impl/i.test(description)),
      false,
      `${surface} leaked jsdom Symbols: ${descriptions.join(', ')}`,
    );
  }
  assert.deepEqual(nonConfigurableProxy, ['impl']);
  assert.equal(engine.active, 0);
});

test('same-origin iframe Realms receive the Plan and cannot use foreign intrinsics to reveal main-Realm internals', async () => {
  const { app, engine } = application();
  const result = await app.execute({
    profile: 'android-webview-v138',
    job: {
      kind: 'run',
      code: `(() => {
        const indexedFrame = document.createElement('iframe');
        document.body.append(indexedFrame);
        const indexed = window[0];
        const namedFrame = document.createElement('iframe');
        namedFrame.name = 'mimicNamedFrame';
        document.body.append(namedFrame);
        const named = frames.mimicNamedFrame;
        const iframe = document.createElement('iframe');
        document.body.append(iframe);
        const foreign = iframe.contentDocument.defaultView;
        const symbols = value => foreign.Object.getOwnPropertySymbols(value).map(String);
        return {
          mainUa: navigator.userAgent,
          ua: foreign.navigator.userAgent,
          indexedUa: indexed.navigator.userAgent,
          indexedIdentity: indexed === frames[0],
          namedUa: named.navigator.userAgent,
          namedSymbols: named.Object.getOwnPropertySymbols(document).map(String),
          alert: foreign.Function.prototype.toString.call(alert),
          childAlert: foreign.Function.prototype.toString.call(foreign.alert),
          document: symbols(document),
          div: symbols(document.createElement('div')),
          window: foreign.Reflect.ownKeys(window).filter(key => typeof key === 'symbol').map(String),
        };
      })()`,
    },
  });

  assert.equal(result.ok, true);
  const value = result.value as Record<string, string | string[] | boolean>;
  assert.equal(value.ua, value.mainUa);
  assert.equal(value.indexedUa, value.mainUa);
  assert.equal(value.indexedIdentity, true);
  assert.equal(value.namedUa, value.mainUa);
  assert.equal(value.alert, 'function alert() { [native code] }');
  assert.equal(value.childAlert, 'function alert() { [native code] }');
  for (const name of ['document', 'div', 'window', 'namedSymbols']) {
    assert.equal((value[name] as string[]).some((symbol) => /impl|webidl2js/i.test(symbol)), false);
  }
  assert.equal(engine.active, 0);
});

test('same-origin iframe network effects are included in the parent Runtime report', async () => {
  const { app, engine } = application();
  const result = await app.execute({
    profile: 'android-webview-v138',
    job: {
      kind: 'capture',
      code: `(() => {
        const iframe = document.createElement('iframe');
        iframe.name = 'captureFrame';
        document.body.append(iframe);
        return frames.captureFrame.navigator.sendBeacon('/collect', 'iframe-body');
      })()`,
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    syncCaptured: true,
    captured: 'iframe-body',
    posts: [{ via: 'beacon', tag: '[object String]', len: 11, body: 'iframe-body' }],
  });
  assert.deepEqual(result.report?.net, {
    body: 'iframe-body',
    posts: [{ via: 'beacon', tag: '[object String]', len: 11, body: 'iframe-body' }],
  });
  assert.equal(engine.active, 0);
});

test('same-origin iframe network reports preserve global call order and the first non-empty body', async () => {
  const { app, engine } = application();
  const result = await app.execute({
    profile: 'android-webview-v138',
    job: {
      kind: 'capture',
      code: `(() => {
        navigator.sendBeacon('/root-empty');
        navigator.sendBeacon('/root-empty-string', '');

        const first = document.createElement('iframe');
        document.body.append(first);
        first.contentWindow.navigator.sendBeacon('/child-first', 'child-first');

        navigator.sendBeacon('/root-second', 'main-second');

        const second = document.createElement('iframe');
        document.body.append(second);
        return second.contentWindow.navigator.sendBeacon('/child-last', 'child-last');
      })()`,
    },
  });

  assert.equal(result.ok, true);
  assert.equal((result.value as { captured?: unknown }).captured, 'child-first');
  assert.deepEqual(result.report?.net, {
    body: 'child-first',
    posts: [
      { via: 'beacon', tag: '[object Undefined]', len: 0, body: null },
      { via: 'beacon', tag: '[object String]', len: 0, body: '' },
      { via: 'beacon', tag: '[object String]', len: 11, body: 'child-first' },
      { via: 'beacon', tag: '[object String]', len: 11, body: 'main-second' },
      { via: 'beacon', tag: '[object String]', len: 10, body: 'child-last' },
    ],
  });
  assert.equal(engine.active, 0);
});
