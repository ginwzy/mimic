import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Catalog,
  compile,
  JsdomEngine,
  parseJob,
  parsePage,
  parseProfile,
  parseShape,
  seal,
  type Page,
  type Profile,
  type Shape,
} from '../src/index.js';
import { perfDriver, perfFeature, perfShape } from '../src/features/perf.js';
import { timeDriver, timeFeature, timeShape } from '../src/features/time.js';

const source = { kind: 'manual' as const, hash: 'a'.repeat(64) };
const parts = ['navigator', 'screen', 'window', 'timezone', 'webgl', 'canvas', 'audio', 'fonts'] as const;

function baseShape(): Shape {
  return parseShape(seal({
    schema: 2 as const,
    id: 'chromium/chrome/linux/desktop/149',
    target: {
      engine: 'chromium' as const,
      host: 'chrome' as const,
      platform: 'linux' as const,
      form: 'desktop' as const,
      version: 149,
    },
    level: 'derived' as const,
    source,
    features: [],
    ops: [],
    support: { structure: 'derived' as const },
  }));
}

function profileFor(shape: Shape): Profile {
  const evidence = Object.fromEntries(parts.map((part) => [part, {
    support: 'derived',
    fields: {},
    source,
  }]));
  return parseProfile(seal({
    schema: 2 as const,
    id: 'perf-profile',
    target: shape.target,
    shape: { id: shape.id, hash: shape.hash },
    source,
    navigator: {
      userAgent: 'Chrome/149',
      appVersion: 'Chrome/149',
      platform: 'Linux x86_64',
      vendor: 'Google Inc.',
      language: 'en-US',
      languages: ['en-US'],
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
      cookieEnabled: true,
      userAgentData: {
        brands: [{ brand: 'Chromium', version: '149' }],
        mobile: false,
        platform: 'Linux',
        architecture: 'x86',
        bitness: '64',
        fullVersionList: [{ brand: 'Chromium', version: '149.0.0.0' }],
        model: '',
        platformVersion: '6.0.0',
        uaFullVersion: '149.0.0.0',
        wow64: false,
      },
    },
    screen: {
      width: 1440,
      height: 900,
      availWidth: 1440,
      availHeight: 875,
      availLeft: 0,
      availTop: 0,
      colorDepth: 24,
      pixelDepth: 24,
      orientation: { type: 'landscape-primary', angle: 0 },
    },
    evidence,
  }));
}

function pageFor(clock?: { now: number; seed: number }): Page {
  return parsePage(seal({
    schema: 2 as const,
    id: 'perf-page',
    source,
    url: 'https://example.test/app',
    ...(clock ? { clock } : {}),
  }));
}

function open(options: { clock?: { now: number; seed: number }; time?: boolean } = {}) {
  const shape = perfShape(options.time ? timeShape(baseShape()) : baseShape());
  const profile = profileFor(shape);
  const page = pageFor(options.clock);
  const engine = new JsdomEngine();
  const features = options.time ? [timeFeature, perfFeature] : [perfFeature];
  const drivers = options.time ? { time: timeDriver, perf: perfDriver } : { perf: perfDriver };
  const plan = compile({
    profile,
    page,
    catalog: Catalog.create('perf-test', [shape], features),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: Object.keys(drivers),
  });
  return { engine, plan, runtime: engine.open(plan, drivers) };
}

test('perf exposes native Timeline methods and Realm-correct legacy values', () => {
  const { engine, plan, runtime } = open();
  try {
    assert.equal(plan.support['perf.resources'], 'emulated');
    const result = runtime.run(`JSON.stringify((() => {
      const names = [
        'getEntries', 'getEntriesByType', 'getEntriesByName', 'mark', 'measure',
        'clearMarks', 'clearMeasures', 'clearResourceTimings', 'setResourceTimingBufferSize', 'toJSON',
      ];
      const shape = names.map(name => {
        const fn = Performance.prototype[name];
        return [name, fn.name, fn.length, Function.prototype.toString.call(fn), Object.hasOwn(fn, 'prototype'), fn instanceof Function];
      });
      const timing = performance.timing;
      const navigation = performance.navigation;
      const json = performance.toJSON();
      const origin = performance.timeOrigin;
      return {
        shape,
        now: [typeof performance.now(), performance.now() >= 0, Performance.prototype.now.toString()],
        origin: [Number.isFinite(origin), origin <= Date.now(), Object.getOwnPropertyDescriptor(Performance.prototype, 'timeOrigin').get.toString()],
        timing: [timing === performance.timing, timing instanceof PerformanceTiming, timing instanceof Object,
          timing.navigationStart, timing.fetchStart, timing.responseEnd, timing.loadEventEnd],
        navigation: [navigation === performance.navigation, navigation instanceof PerformanceNavigation,
          navigation.type, navigation.redirectCount],
        json: [json instanceof Object, Object.getPrototypeOf(json) === Object.prototype, json.timeOrigin === origin],
      };
    })())`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    const lengths: Record<string, number> = {
      getEntries: 0,
      getEntriesByType: 1,
      getEntriesByName: 1,
      mark: 1,
      measure: 1,
      clearMarks: 0,
      clearMeasures: 0,
      clearResourceTimings: 0,
      setResourceTimingBufferSize: 1,
      toJSON: 0,
    };
    for (const item of value.shape as Array<[string, string, number, string, boolean, boolean]>) {
      assert.deepEqual(item.slice(0, 3), [item[0], item[0], lengths[item[0]]]);
      assert.match(item[3], new RegExp(`^function ${item[0]}\\(\\) \\{ \\[native code\\] \\}$`));
      assert.deepEqual(item.slice(4), [false, true]);
    }
    assert.deepEqual(value.now.slice(0, 2), ['number', true]);
    assert.match(value.now[2], /^function now\(\) \{ \[native code\] \}$/);
    assert.deepEqual(value.origin.slice(0, 2), [true, true]);
    assert.match(value.origin[2], /^function get timeOrigin\(\) \{ \[native code\] \}$/);
    assert.deepEqual(value.timing.slice(0, 3), [true, true, true]);
    assert.ok(value.timing[3] <= value.timing[4]);
    assert.ok(value.timing[4] <= value.timing[5]);
    assert.ok(value.timing[5] <= value.timing[6]);
    assert.deepEqual(value.navigation, [true, true, 0, 0]);
    assert.deepEqual(value.json, [true, true, true]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('perf keeps Timeline entries ordered, queryable and clearable within one Runtime', () => {
  const { engine, runtime } = open();
  try {
    const result = runtime.run(`JSON.stringify((() => {
      const resources = performance.getEntriesByType('resource');
      const navigation = performance.getEntriesByType('navigation');
      const start = performance.mark('start');
      const end = performance.mark('end');
      const span = performance.measure('span', 'start', 'end');
      const named = performance.getEntriesByName('start', 'mark');
      const all = performance.getEntries();
      const before = {
        resourceRealm: [resources instanceof Array, Object.getPrototypeOf(resources) === Array.prototype],
        resource: [resources.length, resources.every(entry => entry instanceof PerformanceResourceTiming && entry instanceof PerformanceEntry),
          resources.map(entry => [entry.entryType, entry.duration, entry.startTime])],
        navigation: [navigation.length, navigation[0] instanceof PerformanceNavigationTiming,
          navigation[0] instanceof PerformanceResourceTiming, navigation[0].name],
        marks: [start instanceof PerformanceMark, end instanceof PerformanceMark, named.length, named[0] === start,
          start.entryType, start.duration],
        measure: [span instanceof PerformanceMeasure, span.entryType, span.startTime, span.duration,
          start.startTime, end.startTime],
        order: all.every((entry, index) => index === 0 || all[index - 1].startTime <= entry.startTime),
      };
      performance.clearMarks('start');
      const afterNamedClear = [performance.getEntriesByName('start').length, performance.getEntriesByType('mark').map(entry => entry.name)];
      performance.clearMarks();
      performance.clearMeasures('span');
      performance.clearResourceTimings();
      const afterAllClear = ['mark', 'measure', 'resource'].map(type => performance.getEntriesByType(type).length);
      return { before, afterNamedClear, afterAllClear };
    })())`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    assert.deepEqual(value.before.resourceRealm, [true, true]);
    assert.deepEqual(value.before.resource.slice(0, 2), [2, true]);
    assert.deepEqual(value.before.resource[2], [['resource', 0, 0], ['resource', 0, 0]]);
    assert.deepEqual(value.before.navigation, [1, true, true, 'https://example.test/app']);
    assert.deepEqual(value.before.marks, [true, true, 1, true, 'mark', 0]);
    assert.equal(value.before.measure[0], true);
    assert.equal(value.before.measure[1], 'measure');
    assert.equal(value.before.measure[2], value.before.measure[4]);
    assert.equal(value.before.measure[3], value.before.measure[5] - value.before.measure[4]);
    assert.equal(value.before.order, true);
    assert.deepEqual(value.afterNamedClear, [0, ['end']]);
    assert.deepEqual(value.afterAllClear, [0, 0, 0]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('perf shares Page.clock only when the Shape includes time', () => {
  const now = 946_684_800_123;
  const fixed = open({ clock: { now, seed: 42 }, time: true });
  const independent = open({ clock: { now, seed: 42 } });
  try {
    const fixedResult = fixed.runtime.run(`JSON.stringify((() => {
      const mark = performance.mark('fixed');
      return {
        date: Date.now(),
        origin: performance.timeOrigin,
        now: performance.now(),
        sum: performance.timeOrigin + performance.now(),
        timing: [performance.timing.navigationStart, performance.timing.loadEventEnd],
        mark: mark.startTime,
      };
    })())`);
    assert.equal(fixedResult.ok, true);
    assert.deepEqual(JSON.parse(String(fixedResult.value)), {
      date: now,
      origin: now,
      now: 0,
      sum: now,
      timing: [now, now],
      mark: 0,
    });

    const independentResult = independent.runtime.run(`JSON.stringify({
      origin: performance.timeOrigin,
      date: Date.now(),
      coherent: Math.abs(performance.timeOrigin + performance.now() - Date.now()) < 20
    })`);
    assert.equal(independentResult.ok, true);
    const value = JSON.parse(String(independentResult.value));
    assert.notEqual(value.origin, now);
    assert.ok(value.date > now);
    assert.equal(value.coherent, true);
  } finally {
    fixed.runtime.dispose();
    independent.runtime.dispose();
  }
  assert.equal(fixed.engine.active, 0);
  assert.equal(independent.engine.active, 0);
});

test('perf exposes PaintTiming and an emulated Realm-correct PerformanceObserver surface', () => {
  const { engine, runtime } = open();
  try {
    const result = runtime.run(`JSON.stringify((() => {
      const paints = performance.getEntriesByType('paint');
      const supported = PerformanceObserver.supportedEntryTypes;
      const observer = new PerformanceObserver(() => {});
      observer.observe({ entryTypes: ['mark', 'measure'] });
      const records = observer.takeRecords();
      observer.disconnect();
      let callError;
      let callbackError;
      let entryError;
      try { PerformanceObserver(() => {}); } catch (error) { callError = error.name; }
      try { new PerformanceObserver(null); } catch (error) { callbackError = error.name; }
      try { new PerformanceObserverEntryList(); } catch (error) { entryError = error.name; }
      const observerMethods = ['observe', 'disconnect', 'takeRecords'].map(name => {
        const fn = PerformanceObserver.prototype[name];
        return [name, fn.name, fn.length, fn.toString(), Object.hasOwn(fn, 'prototype')];
      });
      const entryMethods = ['getEntries', 'getEntriesByType', 'getEntriesByName'].map(name => {
        const fn = PerformanceObserverEntryList.prototype[name];
        return [name, fn.name, fn.length, fn.toString(), Object.hasOwn(fn, 'prototype')];
      });
      const fakeList = Object.create(PerformanceObserverEntryList.prototype);
      return {
        paints: [paints instanceof Array, paints.length, paints.map(entry => [
          entry.name, entry.entryType, entry instanceof PerformancePaintTiming, entry instanceof PerformanceEntry,
        ])],
        observer: [observer instanceof PerformanceObserver, Object.getPrototypeOf(observer) === PerformanceObserver.prototype,
          records instanceof Array, records.length, callError, callbackError],
        supported: [supported instanceof Array, supported, Object.getOwnPropertyDescriptor(PerformanceObserver, 'supportedEntryTypes').get.toString()],
        observerShape: [PerformanceObserver.name, PerformanceObserver.length, PerformanceObserver.toString(), observerMethods],
        entryList: [entryError, fakeList.getEntries() instanceof Array, fakeList.getEntries().length, entryMethods],
      };
    })())`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    assert.deepEqual(value.paints, [true, 2, [
      ['first-paint', 'paint', true, true],
      ['first-contentful-paint', 'paint', true, true],
    ]]);
    assert.deepEqual(value.observer, [true, true, true, 0, 'TypeError', 'TypeError']);
    assert.equal(value.supported[0], true);
    assert.deepEqual(value.supported[1], [
      'element', 'event', 'first-input', 'largest-contentful-paint', 'layout-shift',
      'longtask', 'mark', 'measure', 'navigation', 'paint', 'resource',
    ]);
    assert.match(value.supported[2], /^function get supportedEntryTypes\(\) \{ \[native code\] \}$/);
    assert.deepEqual(value.observerShape.slice(0, 2), ['PerformanceObserver', 1]);
    assert.match(value.observerShape[2], /^function PerformanceObserver\(\) \{ \[native code\] \}$/);
    assert.deepEqual(value.observerShape[3].map((item: unknown[]) => item.slice(0, 3)), [
      ['observe', 'observe', 1], ['disconnect', 'disconnect', 0], ['takeRecords', 'takeRecords', 0],
    ]);
    for (const item of value.observerShape[3]) {
      assert.match(item[3], new RegExp(`^function ${item[0]}\\(\\) \\{ \\[native code\\] \\}$`));
      assert.equal(item[4], false);
    }
    assert.deepEqual(value.entryList.slice(0, 3), ['TypeError', true, 0]);
    assert.deepEqual(value.entryList[3].map((item: unknown[]) => item.slice(0, 3)), [
      ['getEntries', 'getEntries', 0], ['getEntriesByType', 'getEntriesByType', 1], ['getEntriesByName', 'getEntriesByName', 1],
    ]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});
