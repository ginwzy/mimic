import type { JsonValue, PerformanceResource } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';

const SUPPORTED = [
  'element', 'event', 'first-input', 'largest-contentful-paint', 'layout-shift',
  'longtask', 'mark', 'measure', 'navigation', 'paint', 'resource',
] as const;

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
