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
// Chrome NetworkInformation also exposes non-standard `type` (wifi/cellular/…);
// Cebu BMS packs [effectiveType, rtt, type] into iV864/iV261.
const CONNECTION = ['effectiveType', 'downlink', 'rtt', 'saveData', 'type'] as const;

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

function storageOperations(): DraftOp[] {
  const storage = { node: 'nav.storage.proto' } as const;
  return [
    { op: 'alloc', id: 'nav.storage.proto', kind: 'object' },
    { op: 'alloc', id: 'nav.storage.instance', kind: 'object' },
    ctor('nav.storage.ctor', 'nav.storage.ctor', 'StorageManager', storage),
    fn('nav.storage.get', 'nav.storage', 'get storage'),
    fn('nav.storage.estimate', 'nav.storage.estimate', 'estimate'),
    fn('nav.storage.getDirectory', 'nav.storage.getDirectory', 'getDirectory'),
    fn('nav.storage.persist', 'nav.storage.persist', 'persist'),
    fn('nav.storage.persisted', 'nav.storage.persisted', 'persisted'),
    { op: 'proto', target: storage, value: { path: 'window.Object.prototype' } },
    { op: 'proto', target: { node: 'nav.storage.instance' }, value: storage },
    refProp({ path: 'window' }, 'StorageManager', 'nav.storage.ctor'),
    refProp(storage, 'constructor', 'nav.storage.ctor'),
    refProp(storage, 'estimate', 'nav.storage.estimate', true),
    refProp(storage, 'getDirectory', 'nav.storage.getDirectory', true),
    refProp(storage, 'persist', 'nav.storage.persist', true),
    refProp(storage, 'persisted', 'nav.storage.persisted', true),
    tag(storage, 'StorageManager'),
    accessor({ path: 'window.Navigator.prototype' }, 'storage', 'nav.storage.get'),
    {
      op: 'order', target: storage,
      keys: ['persisted', 'persist', 'estimate', 'getDirectory', 'constructor', { symbol: 'toStringTag' }],
    },
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

/** Default devices before permission — Chrome-like empty id/label placeholders. */
const MEDIA_DEVICES = [
  { deviceId: '', kind: 'audioinput', label: '', groupId: '' },
  { deviceId: '', kind: 'videoinput', label: '', groupId: '' },
  { deviceId: '', kind: 'audiooutput', label: '', groupId: '' },
] as const;

function mediaDevicesOperations(): DraftOp[] {
  const media = { node: 'nav.mediaDevices.proto' } as const;
  return [
    { op: 'alloc', id: 'nav.mediaDevices.proto', kind: 'object' },
    { op: 'alloc', id: 'nav.mediaDevices.instance', kind: 'event' },
    ctor('nav.mediaDevices.ctor', 'nav.mediaDevices.ctor', 'MediaDevices', media),
    fn('nav.mediaDevices.get', 'nav.mediaDevices', 'get mediaDevices'),
    fn('nav.mediaDevices.enumerateDevices', 'nav.mediaDevices.enumerateDevices', 'enumerateDevices'),
    fn('nav.mediaDevices.getSupportedConstraints', 'nav.mediaDevices.getSupportedConstraints', 'getSupportedConstraints'),
    fn('nav.mediaDevices.ondevicechange.get', 'nav.mediaDevices.ondevicechange.get', 'get ondevicechange'),
    fn('nav.mediaDevices.ondevicechange.set', 'nav.mediaDevices.ondevicechange.set', 'set ondevicechange', 1),
    { op: 'proto', target: media, value: { path: 'window.EventTarget.prototype' } },
    { op: 'proto', target: { node: 'nav.mediaDevices.instance' }, value: media },
    refProp({ path: 'window' }, 'MediaDevices', 'nav.mediaDevices.ctor'),
    refProp(media, 'constructor', 'nav.mediaDevices.ctor'),
    tag(media, 'MediaDevices'),
    accessor({ path: 'window.Navigator.prototype' }, 'mediaDevices', 'nav.mediaDevices.get'),
    refProp(media, 'enumerateDevices', 'nav.mediaDevices.enumerateDevices', true),
    refProp(media, 'getSupportedConstraints', 'nav.mediaDevices.getSupportedConstraints', true),
    accessor(media, 'ondevicechange', 'nav.mediaDevices.ondevicechange.get', 'nav.mediaDevices.ondevicechange.set'),
    {
      op: 'order', target: media,
      keys: [
        'enumerateDevices', 'getSupportedConstraints', 'ondevicechange',
        'constructor', { symbol: 'toStringTag' },
      ],
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
  rev: '4',
  requires: ['touch'],
  build: ({ profile, page, shape }) => {
    const connection = page?.connection;
    const connectionSupport: Support = connection ? 'captured' : 'unsupported';
    return {
      operations: [
        ...storageOperations(),
        ...mediaDevicesOperations(),
        ...(connection ? connectionOperations() : []),
      ],
      binds: [
        { slot: 'nav.window', driver: 'nav', config: { op: 'node', id: 'nav.instance' } },
        ...SCALARS.map((name) => ({ slot: `nav.${name}`, driver: 'nav', config: { op: 'value', value: profile.navigator[name] } })),
        { slot: 'nav.webdriver', driver: 'nav', config: { op: 'value', value: false } },
        { slot: 'nav.pdfViewerEnabled', driver: 'nav', config: { op: 'value', value: shape.target.host === 'chrome' } },
        { slot: 'nav.doNotTrack', driver: 'nav', config: { op: 'value', value: null } },
        { slot: 'nav.onLine', driver: 'nav', config: { op: 'value', value: true } },
        { slot: 'nav.storage.ctor', driver: 'nav', config: { op: 'illegal' } },
        { slot: 'nav.storage', driver: 'nav', config: { op: 'node', id: 'nav.storage.instance' } },
        { slot: 'nav.storage.estimate', driver: 'nav', config: { op: 'resolve', value: { quota: 10_737_418_240, usage: 0 } } },
        { slot: 'nav.storage.getDirectory', driver: 'nav', config: { op: 'resolve', value: null } },
        { slot: 'nav.storage.persist', driver: 'nav', config: { op: 'resolve', value: false } },
        { slot: 'nav.storage.persisted', driver: 'nav', config: { op: 'resolve', value: false } },
        { slot: 'nav.mediaDevices.ctor', driver: 'nav', config: { op: 'illegal' } },
        { slot: 'nav.mediaDevices', driver: 'nav', config: { op: 'node', id: 'nav.mediaDevices.instance' } },
        {
          slot: 'nav.mediaDevices.enumerateDevices',
          driver: 'nav',
          config: { op: 'resolve', value: [...MEDIA_DEVICES] },
        },
        {
          slot: 'nav.mediaDevices.getSupportedConstraints',
          driver: 'nav',
          config: {
            op: 'value',
            value: {
              aspectRatio: true, autoGainControl: true, channelCount: true, deviceId: true,
              echoCancellation: true, facingMode: true, frameRate: true, groupId: true,
              height: true, noiseSuppression: true, sampleRate: true, sampleSize: true, width: true,
            },
          },
        },
        { slot: 'nav.mediaDevices.ondevicechange.get', driver: 'nav', config: { op: 'handler-get', name: 'ondevicechange' } },
        { slot: 'nav.mediaDevices.ondevicechange.set', driver: 'nav', config: { op: 'handler-set', name: 'ondevicechange' } },
        ...(connection ? [
          { slot: 'nav.connection.ctor', driver: 'nav', config: { op: 'illegal' } },
          { slot: 'nav.connection', driver: 'nav', config: { op: 'node', id: 'nav.connection.instance' } },
          ...CONNECTION.map((name) => {
            let value: string | number | boolean;
            if (name === 'type') {
              // profiles without `type` still need a string; Android Chrome often reports wifi
              value = connection.type ?? (shape.target.form === 'mobile' ? 'wifi' : 'ethernet');
            } else if (name === 'effectiveType') {
              value = connection.effectiveType;
            } else if (name === 'downlink') {
              value = connection.downlink;
            } else if (name === 'rtt') {
              value = connection.rtt;
            } else {
              value = connection.saveData;
            }
            return {
              slot: `nav.connection.${name}`,
              driver: 'nav',
              config: { op: 'value', value },
            };
          }),
          { slot: 'nav.connection.onchange.get', driver: 'nav', config: { op: 'handler-get', name: 'onchange' } },
          { slot: 'nav.connection.onchange.set', driver: 'nav', config: { op: 'handler-set', name: 'onchange' } },
        ] : []),
      ],
      support: {
        'nav.data': profile.evidence.navigator.support,
        'storage.data': 'emulated',
        'mediadevices.data': 'emulated',
        'connection.data': connectionSupport,
      },
    };
  },
};

export const navDriver: Driver = dataDriver;
