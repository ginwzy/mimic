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
} from '../../src/v2/index.js';
import { timeDriver, timeFeature, timeShape } from '../../src/v2/features/time.js';

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

function profileFor(shape: Shape, timeZone: string | undefined): Profile {
  const evidence = Object.fromEntries(parts.map((part) => [part, {
    support: part === 'timezone' && timeZone === undefined ? 'unsupported' : 'derived',
    fields: {},
    source,
  }]));
  return parseProfile(seal({
    schema: 2 as const,
    id: 'time-profile',
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
    ...(timeZone === undefined ? {} : { timezone: { timeZone, offset: 0 } }),
    evidence,
  }));
}

function pageFor(clock: { now: number; seed: number } | undefined): Page {
  return parsePage(seal({
    schema: 2 as const,
    id: 'time-page',
    source,
    ...(clock === undefined ? {} : { clock }),
  }));
}

function open(options: {
  clock?: { now: number; seed: number };
  timeZone?: string | undefined;
} = {}) {
  const shape = timeShape(baseShape());
  const profile = profileFor(shape, Object.hasOwn(options, 'timeZone') ? options.timeZone : 'UTC');
  const page = pageFor(options.clock);
  const engine = new JsdomEngine();
  const plan = compile({
    profile,
    page,
    catalog: Catalog.create('time-test', [shape], [timeFeature]),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: ['time'],
  });
  return { engine, plan, runtime: engine.open(plan, { time: timeDriver }) };
}

test('time fixes Date zero-argument time while preserving Date semantics and shape', () => {
  const now = 1_735_689_600_123;
  const { engine, runtime } = open({ clock: { now, seed: 0x1234_5678 } });
  try {
    const result = runtime.run(`JSON.stringify((() => {
      class EpochDate extends Date {}
      const fixed = new Date()
      const epoch = new Date(0)
      const text = Date('ignored')
      const child = new EpochDate(0)
      return {
        fixed: [Date.now(), fixed.getTime(), text === fixed.toString()],
        params: [epoch.getTime(), new Date('2020-01-02T03:04:05.006Z').toISOString(), Date.parse('1970-01-01T00:00:00.000Z'), Date.UTC(1970, 0, 1)],
        subclass: [child.getTime(), child instanceof Date, child instanceof EpochDate, Object.getPrototypeOf(child) === EpochDate.prototype],
        realm: [Date instanceof Function, fixed instanceof Date, Object.getPrototypeOf(fixed) === Date.prototype, Date.prototype.constructor === Date],
        shape: [Date.name, Date.length, Function.prototype.toString.call(Date), Reflect.ownKeys(Date).map(String)],
      }
    })())`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      fixed: [now, now, true],
      params: [0, '2020-01-02T03:04:05.006Z', 0, 0],
      subclass: [0, true, true, true],
      realm: [true, true, true, true],
      shape: ['Date', 7, 'function Date() { [native code] }', ['length', 'name', 'prototype', 'now', 'parse', 'UTC']],
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('time seeds an independent deterministic random stream for each Runtime', () => {
  const first = open({ clock: { now: 1_735_689_600_123, seed: 0x1234_5678 } });
  const second = open({ clock: { now: 1_735_689_600_123, seed: 0x1234_5678 } });
  try {
    const code = `JSON.stringify({
      values: [Math.random(), Math.random(), Math.random(), Math.random()],
      shape: [Math.random.name, Math.random.length, Function.prototype.toString.call(Math.random), Math.random instanceof Function]
    })`;
    const left = first.runtime.run(code);
    const right = second.runtime.run(code);
    assert.equal(left.ok, true);
    assert.equal(right.ok, true);
    const a = JSON.parse(String(left.value));
    const b = JSON.parse(String(right.value));
    assert.deepEqual(a.values, b.values);
    assert.equal(new Set(a.values).size, a.values.length);
    assert.ok(a.values.every((value: number) => value >= 0 && value < 1));
    assert.deepEqual(a.shape, ['random', 0, 'function random() { [native code] }', true]);

    const nextA = first.runtime.run('Math.random()');
    const nextB = second.runtime.run('Math.random()');
    assert.equal(nextA.ok, true);
    assert.equal(nextB.ok, true);
    assert.equal(nextA.value, nextB.value);
  } finally {
    first.runtime.dispose();
    second.runtime.dispose();
  }
  assert.equal(first.engine.active, 0);
  assert.equal(second.engine.active, 0);
});

test('time derives deterministic random streams for each iframe Realm', () => {
  const first = open({ clock: { now: 1_735_689_600_123, seed: 0x1234_5678 } });
  const second = open({ clock: { now: 1_735_689_600_123, seed: 0x1234_5678 } });
  try {
    const code = `JSON.stringify((() => {
      const firstFrame = document.createElement('iframe');
      document.body.append(firstFrame);
      const secondFrame = document.createElement('iframe');
      document.body.append(secondFrame);
      const sample = realm => [realm.Math.random(), realm.Math.random(), realm.Math.random()];
      return {
        main: sample(window),
        first: sample(firstFrame.contentWindow),
        second: sample(secondFrame.contentWindow),
      };
    })())`;
    const left = first.runtime.run(code);
    const right = second.runtime.run(code);
    assert.equal(left.ok, true);
    assert.equal(right.ok, true);
    const a = JSON.parse(String(left.value));
    const b = JSON.parse(String(right.value));
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.main, a.first);
    assert.notDeepEqual(a.main, a.second);
    assert.notDeepEqual(a.first, a.second);
  } finally {
    first.runtime.dispose();
    second.runtime.dispose();
  }
  assert.equal(first.engine.active, 0);
  assert.equal(second.engine.active, 0);
});

test('time replays the Profile timezone across Intl and Date', () => {
  const { engine, runtime } = open({
    clock: { now: 1_735_689_600_000, seed: 0x1234_5678 },
    timeZone: 'America/New_York',
  });
  try {
    const result = runtime.run(`JSON.stringify((() => {
      const options = { year: 'numeric' }
      const called = Intl.DateTimeFormat('en-US', options)
      const made = new Intl.DateTimeFormat('en-US')
      const explicit = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo' })
      const date = new Date(Date.UTC(2025, 0, 1, 0, 0, 0))
      const constructed = new Date(2025, 0, 1, 0, 0, 0, 0)
      const parsed = Date.parse('2025-01-01T00:00:00.000')
      const mutated = new Date(2025, 0, 1, 0, 0, 0, 0)
      const set = mutated.setHours(2, 30, 0, 0)
      const recovered = new Date(NaN)
      recovered.setFullYear(2025)
      let bigInt
      try { new Date(2025n, 0); bigInt = 'accepted' } catch (error) { bigInt = error.name }
      const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit' }
      const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
      const fullOptions = { ...dateOptions, ...timeOptions }
      return {
        zones: [called.resolvedOptions().timeZone, made.resolvedOptions().timeZone, explicit.resolvedOptions().timeZone],
        date: {
          offset: date.getTimezoneOffset(),
          fields: [date.getFullYear(), date.getYear(), date.getMonth(), date.getDate(), date.getDay(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()],
          text: date.toString(),
          dateText: date.toDateString(),
          timeText: date.toTimeString(),
          called: Date(),
        },
        locale: [
          date.toLocaleString('en-US', fullOptions) === new Intl.DateTimeFormat('en-US', fullOptions).format(date),
          date.toLocaleDateString('en-US', dateOptions) === new Intl.DateTimeFormat('en-US', dateOptions).format(date),
          date.toLocaleTimeString('en-US', timeOptions) === new Intl.DateTimeFormat('en-US', timeOptions).format(date),
          date.toLocaleString('en-US', { ...fullOptions, timeZone: 'UTC' }) === new Intl.DateTimeFormat('en-US', { ...fullOptions, timeZone: 'UTC' }).format(date),
        ],
        localInput: [constructed.toISOString(), new Date(parsed).toISOString(), set, mutated.toISOString(), mutated.getHours(), mutated.getMinutes(), recovered.toISOString(), bigInt],
        input: [Object.hasOwn(options, 'timeZone'), options.timeZone],
        realm: [called instanceof Intl.DateTimeFormat, Object.getPrototypeOf(made) === Intl.DateTimeFormat.prototype, Intl.DateTimeFormat.prototype.constructor === Intl.DateTimeFormat],
        locales: Intl.DateTimeFormat.supportedLocalesOf(['en-US']),
        shape: [
          Intl.DateTimeFormat.name,
          Intl.DateTimeFormat.length,
          Function.prototype.toString.call(Intl.DateTimeFormat),
          Reflect.ownKeys(Intl.DateTimeFormat).map(String),
          [date.getTimezoneOffset.name, date.getTimezoneOffset.length, Function.prototype.toString.call(date.getTimezoneOffset)],
          [date.toLocaleString.name, date.toLocaleString.length, Function.prototype.toString.call(date.toLocaleString)],
        ],
      }
    })())`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    assert.deepEqual(value.zones, ['America/New_York', 'America/New_York', 'Asia/Tokyo']);
    assert.equal(value.date.offset, 300);
    assert.deepEqual(value.date.fields, [2024, 124, 11, 31, 2, 19, 0, 0, 0]);
    assert.match(value.date.text, /^Tue Dec 31 2024 19:00:00 GMT-0500 \(.+\)$/);
    assert.equal(value.date.dateText, 'Tue Dec 31 2024');
    assert.match(value.date.timeText, /^19:00:00 GMT-0500 \(.+\)$/);
    assert.equal(value.date.called, value.date.text);
    assert.deepEqual(value.locale, [true, true, true, true]);
    assert.deepEqual(value.localInput, [
      '2025-01-01T05:00:00.000Z',
      '2025-01-01T05:00:00.000Z',
      Date.UTC(2025, 0, 1, 7, 30),
      '2025-01-01T07:30:00.000Z',
      2,
      30,
      '2025-01-01T05:00:00.000Z',
      'TypeError',
    ]);
    assert.deepEqual({
      input: value.input,
      realm: value.realm,
      locales: value.locales,
      shape: value.shape,
    }, {
      input: [false, null],
      realm: [true, true, true],
      locales: ['en-US'],
      shape: [
        'DateTimeFormat', 0, 'function DateTimeFormat() { [native code] }', ['length', 'name', 'prototype', 'supportedLocalesOf'],
        ['getTimezoneOffset', 0, 'function getTimezoneOffset() { [native code] }'],
        ['toLocaleString', 0, 'function toLocaleString() { [native code] }'],
      ],
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('time falls back to Realm sources when clock and timezone data are absent', () => {
  const before = Date.now();
  const { engine, plan, runtime } = open({ timeZone: undefined });
  try {
    const result = runtime.run(`JSON.stringify({
      now: Date.now(),
      made: new Date().getTime(),
      called: Date(),
      random: Math.random(),
      zone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      explicit: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().timeZone,
      offset: new Date(0).getTimezoneOffset(),
      text: new Date(0).toString(),
      hour: new Date(0).getHours()
    })`);
    const after = Date.now();
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    assert.ok(value.now >= before && value.now <= after);
    assert.ok(value.made >= before && value.made <= after);
    assert.ok(Number.isFinite(Date.parse(value.called)));
    assert.ok(value.random >= 0 && value.random < 1);
    assert.equal(typeof value.zone, 'string');
    assert.ok(value.zone.length > 0);
    assert.equal(value.explicit, 'UTC');
    assert.equal(value.offset, new Date(0).getTimezoneOffset());
    assert.equal(value.text, new Date(0).toString());
    assert.equal(value.hour, new Date(0).getHours());
    assert.equal(plan.support['time.clock'], 'unsupported');
    assert.equal(plan.support['time.random'], 'unsupported');
    assert.equal(plan.support['time.timezone'], 'unsupported');
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});
