import { describeCoverage } from './capabilities.js';
import type { JsonValue, Page, Support } from '../core/types.js';
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

export function operations(): DraftOp[] {
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

function resourceSupport(page: Page | undefined): Support {
  if (page?.performance === undefined) return 'unsupported';
  if (page.source.kind === 'capture') return 'captured';
  if (page.source.kind === 'derived' || page.source.kind === 'fp-env') return 'derived';
  return 'emulated';
}

export const perfFeature: Feature = {
  id: 'perf',
  describe: (_context, support) => describeCoverage(support, {
    'perf.api': 'partial',
    'perf.clock': 'partial',
    'perf.resources': 'constant',
    'perf.user-timing': 'partial',
    'perf.legacy': 'constant',
    'perf.observer': 'partial',
    'perf.memory': 'constant',
  }),
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
