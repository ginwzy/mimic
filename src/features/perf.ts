import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Page, PerformanceResource, Shape, Support } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import type { DraftOp, Feature, Ref } from '../shape/types.js';
import { accessor, ctor, fn, fnShape, refProp, tag } from './ops.js';

const PERF = { path: 'window.Performance.prototype' } as const;

const METHODS = [
  ['getEntries', 0],
  ['getEntriesByType', 1],
  ['getEntriesByName', 1],
  ['mark', 1],
  ['measure', 1],
  ['clearMarks', 0],
  ['clearMeasures', 0],
  ['clearResourceTimings', 0],
  ['setResourceTimingBufferSize', 1],
  ['toJSON', 0],
] as const;

const SUPPORTED = [
  'element', 'event', 'first-input', 'largest-contentful-paint', 'layout-shift',
  'longtask', 'mark', 'measure', 'navigation', 'paint', 'resource',
] as const;

const INTERFACES = [
  ['entry', 'PerformanceEntry', { path: 'window.Object.prototype' }],
  ['resource', 'PerformanceResourceTiming', { node: 'perf.entry.proto' }],
  ['navigation-entry', 'PerformanceNavigationTiming', { node: 'perf.resource.proto' }],
  ['mark', 'PerformanceMark', { node: 'perf.entry.proto' }],
  ['measure', 'PerformanceMeasure', { node: 'perf.entry.proto' }],
  ['paint', 'PerformancePaintTiming', { node: 'perf.entry.proto' }],
  ['timing', 'PerformanceTiming', { path: 'window.Object.prototype' }],
  ['navigation', 'PerformanceNavigation', { path: 'window.Object.prototype' }],
  ['observer-list', 'PerformanceObserverEntryList', { path: 'window.Object.prototype' }],
] as const satisfies readonly (readonly [string, string, Ref])[];

function operations(): DraftOp[] {
  const ops: DraftOp[] = [
    {
      op: 'fn', target: { path: 'window.Performance' },
      shape: fnShape('Performance', 0, true, true),
    },
    fn('perf.now', 'perf.now', 'now'),
    fn('perf.time-origin.get', 'perf.time-origin', 'get timeOrigin'),
    refProp(PERF, 'now', 'perf.now', true),
    accessor(PERF, 'timeOrigin', 'perf.time-origin.get'),
  ];

  for (const [id, name, parent] of INTERFACES) {
    const proto = { node: `perf.${id}.proto` } as const;
    const keys = id === 'observer-list'
      ? ['constructor', 'getEntries', 'getEntriesByType', 'getEntriesByName', { symbol: 'toStringTag' } as const]
      : ['constructor', { symbol: 'toStringTag' } as const];
    ops.push(
      { op: 'alloc', id: `perf.${id}.proto`, kind: 'object' },
      ctor(`perf.${id}.ctor`, `perf.${id}.ctor`, name, proto),
      { op: 'proto', target: proto, value: parent },
      refProp({ path: 'window' }, name, `perf.${id}.ctor`),
      refProp(proto, 'constructor', `perf.${id}.ctor`),
      tag(proto, name),
      { op: 'order', target: proto, keys },
    );
  }

  for (const [name, length] of [['getEntries', 0], ['getEntriesByType', 1], ['getEntriesByName', 1]] as const) {
    ops.push(
      fn(`perf.observer-list.${name}`, `perf.observer-list.${name}`, name, length),
      refProp({ node: 'perf.observer-list.proto' }, name, `perf.observer-list.${name}`, true),
    );
  }

  ops.push(
    { op: 'alloc', id: 'perf.observer.proto', kind: 'object' },
    {
      op: 'alloc', id: 'perf.observer.ctor', kind: 'function', slot: 'perf.observer.ctor',
      shape: fnShape('PerformanceObserver', 1, true, true),
      prototype: { node: 'perf.observer.proto' },
    },
    { op: 'proto', target: { node: 'perf.observer.proto' }, value: { path: 'window.Object.prototype' } },
    refProp({ path: 'window' }, 'PerformanceObserver', 'perf.observer.ctor'),
    refProp({ node: 'perf.observer.proto' }, 'constructor', 'perf.observer.ctor'),
    tag({ node: 'perf.observer.proto' }, 'PerformanceObserver'),
    fn('perf.observer.observe', 'perf.observer.observe', 'observe', 1),
    fn('perf.observer.disconnect', 'perf.observer.disconnect', 'disconnect'),
    fn('perf.observer.take', 'perf.observer.take', 'takeRecords'),
    fn('perf.observer.supported.get', 'perf.observer.supported', 'get supportedEntryTypes'),
    refProp({ node: 'perf.observer.proto' }, 'observe', 'perf.observer.observe', true),
    refProp({ node: 'perf.observer.proto' }, 'disconnect', 'perf.observer.disconnect', true),
    refProp({ node: 'perf.observer.proto' }, 'takeRecords', 'perf.observer.take', true),
    accessor({ node: 'perf.observer.ctor' }, 'supportedEntryTypes', 'perf.observer.supported.get'),
    {
      op: 'order', target: { node: 'perf.observer.proto' },
      keys: ['constructor', 'observe', 'disconnect', 'takeRecords', { symbol: 'toStringTag' }],
    },
    {
      op: 'order', target: { node: 'perf.observer.ctor' },
      keys: ['length', 'name', 'prototype', 'supportedEntryTypes'],
    },
  );

  for (const [name, length] of METHODS) {
    ops.push(
      fn(`perf.${name}`, `perf.${name}`, name, length),
      refProp(PERF, name, `perf.${name}`, true),
    );
  }
  ops.push(
    fn('perf.timing.get', 'perf.timing', 'get timing'),
    fn('perf.navigation.get', 'perf.navigation', 'get navigation'),
    // Chrome non-standard; BMS packs heap sizes into sensors (real iV724).
    fn('perf.memory.get', 'perf.memory', 'get memory'),
    accessor(PERF, 'timing', 'perf.timing.get'),
    accessor(PERF, 'navigation', 'perf.navigation.get'),
    accessor(PERF, 'memory', 'perf.memory.get'),
    {
      op: 'order', target: PERF,
      keys: [
        'constructor', 'timeOrigin', 'now', 'clearResourceTimings', 'setResourceTimingBufferSize',
        'getEntries', 'getEntriesByType', 'getEntriesByName', 'mark', 'clearMarks',
        'measure', 'clearMeasures', 'toJSON', 'timing', 'navigation', 'memory', { symbol: 'toStringTag' },
      ],
    },
    // MemoryInfo surface (Chrome-only)
    { op: 'alloc', id: 'perf.memory.proto', kind: 'object' },
    { op: 'alloc', id: 'perf.memory.instance', kind: 'object' },
    { op: 'proto', target: { node: 'perf.memory.proto' }, value: { path: 'window.Object.prototype' } },
    { op: 'proto', target: { node: 'perf.memory.instance' }, value: { node: 'perf.memory.proto' } },
    fn('perf.memory.jsHeapSizeLimit.get', 'perf.memory.jsHeapSizeLimit', 'get jsHeapSizeLimit'),
    fn('perf.memory.totalJSHeapSize.get', 'perf.memory.totalJSHeapSize', 'get totalJSHeapSize'),
    fn('perf.memory.usedJSHeapSize.get', 'perf.memory.usedJSHeapSize', 'get usedJSHeapSize'),
    accessor({ node: 'perf.memory.proto' }, 'jsHeapSizeLimit', 'perf.memory.jsHeapSizeLimit.get'),
    accessor({ node: 'perf.memory.proto' }, 'totalJSHeapSize', 'perf.memory.totalJSHeapSize.get'),
    accessor({ node: 'perf.memory.proto' }, 'usedJSHeapSize', 'perf.memory.usedJSHeapSize.get'),
    tag({ node: 'perf.memory.proto' }, 'MemoryInfo'),
    {
      op: 'order', target: { node: 'perf.memory.proto' },
      keys: ['jsHeapSizeLimit', 'totalJSHeapSize', 'usedJSHeapSize', { symbol: 'toStringTag' }],
    },
  );
  return ops;
}

export function perfShape(input: Shape): Shape {
  if (input.features.includes('perf')) return input;
  const { hash: _hash, ...body } = input;
  return parseShape(seal({
    ...body,
    features: [...input.features, 'perf'].sort(),
    ops: [...input.ops, ...operations()],
    support: {
      ...input.support,
      'perf.shape': input.level === 'captured' ? 'captured' : 'derived',
      'perf.api': 'emulated',
    },
  }));
}

function resourceSupport(page: Page | undefined): Support {
  if (page?.performance === undefined) return 'unsupported';
  if (page.source.kind === 'capture') return 'captured';
  if (page.source.kind === 'derived' || page.source.kind === 'fp-env') return 'derived';
  return 'emulated';
}

export const perfFeature: Feature = {
  id: 'perf',
  rev: '1',
  build: ({ page, shape }) => {
    const url = page?.url ?? 'https://example.com/';
    const now = shape.features.includes('time') && page?.clock ? page.clock.now : null;
    const resources = (page?.performance?.resources ?? []).map((resource) => ({ ...resource })) as JsonValue[];
    const base = { url, resources, now };
    return {
      binds: [
        ...INTERFACES.map(([id]) => ({
          slot: `perf.${id}.ctor`, driver: 'perf', config: { op: 'illegal', ...base },
        })),
        ...METHODS.map(([name]) => ({
          slot: `perf.${name}`, driver: 'perf', config: { op: name, ...base },
        })),
        ...(['getEntries', 'getEntriesByType', 'getEntriesByName'] as const).map((name) => ({
          slot: `perf.observer-list.${name}`, driver: 'perf', config: { op: 'empty', ...base },
        })),
        { slot: 'perf.observer.ctor', driver: 'perf', config: { op: 'observer', ...base } },
        { slot: 'perf.observer.observe', driver: 'perf', config: { op: 'observer-observe', ...base } },
        { slot: 'perf.observer.disconnect', driver: 'perf', config: { op: 'observer-disconnect', ...base } },
        { slot: 'perf.observer.take', driver: 'perf', config: { op: 'observer-take', ...base } },
        { slot: 'perf.observer.supported', driver: 'perf', config: { op: 'supported', ...base } },
        { slot: 'perf.now', driver: 'perf', config: { op: 'now', ...base } },
        { slot: 'perf.time-origin', driver: 'perf', config: { op: 'timeOrigin', ...base } },
        { slot: 'perf.timing', driver: 'perf', config: { op: 'timing', ...base } },
        { slot: 'perf.navigation', driver: 'perf', config: { op: 'navigation', ...base } },
        { slot: 'perf.memory', driver: 'perf', config: { op: 'node', id: 'perf.memory.instance', ...base } },
        // ~3.34GB limit / ~70MB total / ~50MB used — typical mid Android Chrome heap window
        { slot: 'perf.memory.jsHeapSizeLimit', driver: 'perf', config: { op: 'value', value: 3_340_000_000, ...base } },
        { slot: 'perf.memory.totalJSHeapSize', driver: 'perf', config: { op: 'value', value: 72_200_000, ...base } },
        { slot: 'perf.memory.usedJSHeapSize', driver: 'perf', config: { op: 'value', value: 53_500_000, ...base } },
      ],
      support: {
        'perf.clock': now === null ? 'derived' : 'emulated',
        'perf.resources': resourceSupport(page),
        'perf.user-timing': 'emulated',
        'perf.legacy': 'emulated',
        'perf.observer': 'emulated',
        'perf.memory': 'emulated',
      },
    };
  },
};

interface Config {
  op: string;
  url: string;
  resources: PerformanceResource[];
  now: number | null;
  id?: string;
  value?: JsonValue;
}

interface Entry {
  value: object;
  name: string;
  type: string;
  start: number;
  order: number;
}

interface State {
  origin: number;
  order: number;
  navigationEntry: Entry;
  resources: Entry[];
  paints: Entry[];
  marks: Entry[];
  measures: Entry[];
  timing: object;
  navigation: object;
}

function config(value: JsonValue | undefined): Config {
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || typeof value.op !== 'string' || typeof value.url !== 'string'
    || !Array.isArray(value.resources)
    || (value.now !== null && (typeof value.now !== 'number' || !Number.isFinite(value.now)))) {
    throw new TypeError('perf Driver config invalid');
  }
  const resources = value.resources.map((resource) => {
    const nonNegative = (field: unknown): field is number => typeof field === 'number'
      && Number.isFinite(field) && field >= 0;
    if (resource === null || Array.isArray(resource) || typeof resource !== 'object'
      || typeof resource.name !== 'string' || resource.name.length === 0
      || typeof resource.initiatorType !== 'string' || !nonNegative(resource.startTime)
      || !nonNegative(resource.duration) || typeof resource.nextHopProtocol !== 'string'
      || !nonNegative(resource.transferSize) || !nonNegative(resource.encodedBodySize)
      || !nonNegative(resource.decodedBodySize) || typeof resource.responseStatus !== 'number'
      || !Number.isInteger(resource.responseStatus)
      || resource.responseStatus < 0 || resource.responseStatus > 999) {
      throw new TypeError('perf resource config invalid');
    }
    return { ...resource } as unknown as PerformanceResource;
  });
  return {
    op: value.op,
    url: value.url,
    resources,
    now: value.now as number | null,
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    ...('value' in value ? { value: value.value as JsonValue } : {}),
  };
}

function realmObject(port: Port, value: Record<string, JsonValue>, proto: string): object {
  const output = port.clone(value);
  const prototype = port.node(proto);
  if (output === null || typeof output !== 'object') throw new TypeError('perf clone is not an object');
  if (prototype === null || (typeof prototype !== 'object' && typeof prototype !== 'function')) {
    throw new TypeError('perf prototype is not an object');
  }
  Object.setPrototypeOf(output, prototype);
  return output;
}

function entry(
  port: Port,
  fields: Record<string, JsonValue>,
  proto: string,
  order: number,
): Entry {
  return {
    value: realmObject(port, fields, proto),
    name: String(fields.name),
    type: String(fields.entryType),
    start: Number(fields.startTime),
    order,
  };
}

function realmList(port: Port, entries: readonly Entry[]): object {
  const output = port.clone([]);
  if (!Array.isArray(output)) throw new TypeError('perf clone is not an array');
  output.push(...entries.map((item) => item.value));
  return output;
}

function legacyTiming(origin: number): Record<string, JsonValue> {
  const time = Math.floor(origin);
  return {
    navigationStart: time,
    unloadEventStart: 0,
    unloadEventEnd: 0,
    redirectStart: 0,
    redirectEnd: 0,
    fetchStart: time,
    domainLookupStart: time,
    domainLookupEnd: time,
    connectStart: time,
    connectEnd: time,
    secureConnectionStart: time,
    requestStart: time,
    responseStart: time,
    responseEnd: time,
    domLoading: time,
    domInteractive: time,
    domContentLoadedEventStart: time,
    domContentLoadedEventEnd: time,
    domComplete: time,
    loadEventStart: time,
    loadEventEnd: time,
  };
}

function createState(port: Port, item: Config): State {
  const rawOrigin = item.now ?? port.origin();
  const origin = Number.isFinite(rawOrigin) ? rawOrigin : port.now();
  let order = 0;
  const navigationEntry = entry(port, {
    name: item.url,
    entryType: 'navigation',
    startTime: 0,
    duration: 0,
    initiatorType: 'navigation',
    type: 'navigate',
    redirectCount: 0,
  }, 'perf.navigation-entry.proto', order++);
  const resources = item.resources.map((resource) => entry(port, {
    ...resource,
    entryType: 'resource',
  }, 'perf.resource.proto', order++));
  const paints = [
    entry(port, {
      name: 'first-paint', entryType: 'paint', startTime: 0, duration: 0,
    }, 'perf.paint.proto', order++),
    entry(port, {
      name: 'first-contentful-paint', entryType: 'paint', startTime: 0, duration: 0,
    }, 'perf.paint.proto', order++),
  ];
  return {
    origin,
    order,
    navigationEntry,
    resources,
    paints,
    marks: [],
    measures: [],
    timing: realmObject(port, legacyTiming(origin), 'perf.timing.proto'),
    navigation: realmObject(port, { type: 0, redirectCount: 0 }, 'perf.navigation.proto'),
  };
}

function entries(state: State): Entry[] {
  return [state.navigationEntry, ...state.resources, ...state.paints, ...state.marks, ...state.measures]
    .sort((left, right) => left.start - right.start || left.order - right.order);
}

function nameOf(value: unknown): string {
  return String(value);
}

export const perfDriver: Driver = {
  open: (port) => {
    let state: State | undefined;
    let observers = new WeakSet<object>();
    const current = (item: Config): State => (state ??= createState(port, item));
    const elapsed = (value: State): number => Math.max(0, port.now() - value.origin);
    const observer = (self: unknown): object => {
      if ((typeof self !== 'object' && typeof self !== 'function') || self === null || !observers.has(self)) {
        throw port.error('TypeError', 'Illegal invocation');
      }
      return self;
    };
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'illegal') throw port.error('TypeError', 'Illegal constructor');
        if (item.op === 'observer') throw port.error('TypeError', "Failed to construct 'PerformanceObserver': Please use the 'new' operator.");
        if (item.op === 'observer-observe' || item.op === 'observer-disconnect') {
          observer(self);
          return undefined;
        }
        if (item.op === 'observer-take') {
          observer(self);
          return realmList(port, []);
        }
        if (item.op === 'empty') return realmList(port, []);
        if (item.op === 'supported') return port.clone([...SUPPORTED]);
        // Chrome performance.memory + MemoryInfo fields
        if (item.op === 'node') return port.node(String(item.id));
        if (item.op === 'value') {
          const v = item.value;
          return v !== null && typeof v === 'object' ? port.clone(v as JsonValue) : v;
        }
        const value = current(item);
        if (item.op === 'now') return elapsed(value);
        if (item.op === 'timeOrigin') return value.origin;
        if (item.op === 'getEntries') return realmList(port, entries(value));
        if (item.op === 'getEntriesByType') {
          const type = nameOf(args[0]);
          return realmList(port, entries(value).filter((candidate) => candidate.type === type));
        }
        if (item.op === 'getEntriesByName') {
          const name = nameOf(args[0]);
          const type = args[1] === undefined ? undefined : nameOf(args[1]);
          return realmList(port, entries(value).filter((candidate) => candidate.name === name && (type === undefined || candidate.type === type)));
        }
        if (item.op === 'mark') {
          const name = nameOf(args[0]);
          const start = elapsed(value);
          const mark = entry(port, {
            name, entryType: 'mark', startTime: start, duration: 0, detail: null,
          }, 'perf.mark.proto', value.order++);
          value.marks.push(mark);
          return mark.value;
        }
        if (item.op === 'measure') {
          const name = nameOf(args[0]);
          const markTime = (argument: unknown): number | undefined => {
            if (argument === undefined) return undefined;
            const markName = nameOf(argument);
            for (let index = value.marks.length - 1; index >= 0; index--) {
              const candidate = value.marks[index];
              if (candidate?.name === markName) return candidate.start;
            }
            return undefined;
          };
          const start = markTime(args[1]) ?? 0;
          const end = markTime(args[2]) ?? elapsed(value);
          const measure = entry(port, {
            name, entryType: 'measure', startTime: start, duration: Math.max(0, end - start), detail: null,
          }, 'perf.measure.proto', value.order++);
          value.measures.push(measure);
          return measure.value;
        }
        if (item.op === 'clearMarks') {
          const name = args[0] === undefined ? undefined : nameOf(args[0]);
          value.marks = name === undefined ? [] : value.marks.filter((candidate) => candidate.name !== name);
          return undefined;
        }
        if (item.op === 'clearMeasures') {
          const name = args[0] === undefined ? undefined : nameOf(args[0]);
          value.measures = name === undefined ? [] : value.measures.filter((candidate) => candidate.name !== name);
          return undefined;
        }
        if (item.op === 'clearResourceTimings') {
          value.resources = [];
          return undefined;
        }
        if (item.op === 'setResourceTimingBufferSize') return undefined;
        if (item.op === 'timing') return value.timing;
        if (item.op === 'navigation') return value.navigation;
        if (item.op === 'toJSON') return port.clone({ timeOrigin: value.origin });
        throw new TypeError(`perf Driver op invalid:${item.op}`);
      },
      construct: (raw, args, newTarget) => {
        const item = config(raw);
        if (item.op === 'observer') {
          if (typeof args[0] !== 'function') {
            throw port.error('TypeError', "Failed to construct 'PerformanceObserver': parameter 1 is not a function.");
          }
          const output = port.clone({});
          const prototype = (newTarget as { prototype?: unknown }).prototype;
          if (output === null || typeof output !== 'object'
            || (typeof prototype !== 'object' && typeof prototype !== 'function') || prototype === null) {
            throw new TypeError('perf observer allocation failed');
          }
          Object.setPrototypeOf(output, prototype);
          observers.add(output);
          return output;
        }
        throw port.error('TypeError', 'Illegal constructor');
      },
      close: () => {
        state = undefined;
        observers = new WeakSet();
      },
    };
  },
};
