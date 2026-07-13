import { dataDriver } from '../drivers/data.js';
import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { Shape, Support } from '../core/types.js';
import type { Driver } from '../engine/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, ctor, fn, refProp, tag } from './ops.js';
import { chromeTouchShape } from './chrome.js';

const SCALARS = [
  'userAgent', 'appVersion', 'platform', 'vendor', 'language', 'languages',
  'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints', 'cookieEnabled',
] as const;
const FIXED = ['webdriver', 'pdfViewerEnabled', 'doNotTrack', 'onLine'] as const;
const CONNECTION = ['effectiveType', 'downlink', 'rtt', 'saveData'] as const;

function operations(): DraftOp[] {
  return [
    { op: 'alloc', id: 'nav.instance', kind: 'proxy', source: { path: 'window.navigator' }, symbols: ['impl'] },
    fn('nav.window.get', 'nav.window', 'get navigator'),
    ...SCALARS.map((name) => fn(`nav.${name}.get`, `nav.${name}`, `get ${name}`)),
    ...FIXED.map((name) => fn(`nav.${name}.get`, `nav.${name}`, `get ${name}`)),
    ...SCALARS.map((name) => accessor({ path: 'window.Navigator.prototype' }, name, `nav.${name}.get`)),
    ...FIXED.map((name) => accessor({ path: 'window.Navigator.prototype' }, name, `nav.${name}.get`)),
    accessor({ path: 'window' }, 'navigator', 'nav.window.get'),
  ];
}

function connectionOperations(): DraftOp[] {
  const network = { node: 'nav.connection.proto' } as const;
  return [
    { op: 'alloc', id: 'nav.connection.proto', kind: 'object' },
    { op: 'alloc', id: 'nav.connection.instance', kind: 'event' },
    ctor('nav.connection.ctor', 'nav.connection.ctor', 'NetworkInformation', network),
    fn('nav.connection.get', 'nav.connection', 'get connection'),
    ...CONNECTION.map((name) => fn(`nav.connection.${name}.get`, `nav.connection.${name}`, `get ${name}`)),
    fn('nav.connection.onchange.get', 'nav.connection.onchange.get', 'get onchange'),
    fn('nav.connection.onchange.set', 'nav.connection.onchange.set', 'set onchange', 1),
    { op: 'proto', target: network, value: { path: 'window.EventTarget.prototype' } },
    { op: 'proto', target: { node: 'nav.connection.instance' }, value: network },
    refProp({ path: 'window' }, 'NetworkInformation', 'nav.connection.ctor'),
    refProp(network, 'constructor', 'nav.connection.ctor'),
    tag(network, 'NetworkInformation'),
    accessor({ path: 'window.Navigator.prototype' }, 'connection', 'nav.connection.get'),
    ...CONNECTION.map((name) => accessor(network, name, `nav.connection.${name}.get`)),
    accessor(network, 'onchange', 'nav.connection.onchange.get', 'nav.connection.onchange.set'),
    {
      op: 'order', target: network,
      keys: [...CONNECTION, 'onchange', 'constructor', { symbol: 'toStringTag' }],
    },
  ];
}

export function navShape(input: Shape): Shape {
  const shape = chromeTouchShape(input);
  if (shape.features.includes('nav')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'nav'].sort(),
    ops: [...shape.ops, ...operations()],
    support: {
      ...shape.support,
      'nav.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'nav.api': 'emulated',
    },
  }));
}

export const navFeature: Feature = {
  id: 'nav',
  rev: '1',
  requires: ['touch'],
  build: ({ profile, page, shape }) => {
    const connection = page?.connection;
    const connectionSupport: Support = connection ? 'captured' : 'unsupported';
    return {
      operations: connection ? connectionOperations() : [],
      binds: [
        { slot: 'nav.window', driver: 'nav', config: { op: 'node', id: 'nav.instance' } },
        ...SCALARS.map((name) => ({ slot: `nav.${name}`, driver: 'nav', config: { op: 'value', value: profile.navigator[name] } })),
        { slot: 'nav.webdriver', driver: 'nav', config: { op: 'value', value: false } },
        { slot: 'nav.pdfViewerEnabled', driver: 'nav', config: { op: 'value', value: shape.target.host === 'chrome' } },
        { slot: 'nav.doNotTrack', driver: 'nav', config: { op: 'value', value: null } },
        { slot: 'nav.onLine', driver: 'nav', config: { op: 'value', value: true } },
        ...(connection ? [
          { slot: 'nav.connection.ctor', driver: 'nav', config: { op: 'illegal' } },
          { slot: 'nav.connection', driver: 'nav', config: { op: 'node', id: 'nav.connection.instance' } },
          ...CONNECTION.map((name) => ({ slot: `nav.connection.${name}`, driver: 'nav', config: { op: 'value', value: connection[name] } })),
          { slot: 'nav.connection.onchange.get', driver: 'nav', config: { op: 'handler-get', name: 'onchange' } },
          { slot: 'nav.connection.onchange.set', driver: 'nav', config: { op: 'handler-set', name: 'onchange' } },
        ] : []),
      ],
      support: {
        'nav.data': profile.evidence.navigator.support,
        'connection.data': connectionSupport,
      },
    };
  },
};

export const navDriver: Driver = dataDriver;
