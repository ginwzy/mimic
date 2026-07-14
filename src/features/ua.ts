import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Shape } from '../core/types.js';
import type { Driver } from '../engine/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, ctor, fn, refProp, tag } from './ops.js';
import { navShape } from './nav.js';

function operations(): DraftOp[] {
  const proto = { node: 'ua.proto' } as const;
  return [
    { op: 'alloc', id: 'ua.proto', kind: 'object' },
    { op: 'alloc', id: 'ua.instance', kind: 'object' },
    ctor('ua.ctor', 'ua.ctor', 'NavigatorUAData', proto),
    fn('ua.window.get', 'ua.window', 'get userAgentData'),
    fn('ua.brands.get', 'ua.brands', 'get brands'),
    fn('ua.mobile.get', 'ua.mobile', 'get mobile'),
    fn('ua.platform.get', 'ua.platform', 'get platform'),
    fn('ua.high', 'ua.high', 'getHighEntropyValues', 1),
    fn('ua.json', 'ua.json', 'toJSON'),
    { op: 'proto', target: { node: 'ua.instance' }, value: proto },
    refProp({ path: 'window' }, 'NavigatorUAData', 'ua.ctor'),
    refProp(proto, 'constructor', 'ua.ctor'),
    tag(proto, 'NavigatorUAData'),
    accessor({ path: 'window.Navigator.prototype' }, 'userAgentData', 'ua.window.get'),
    accessor(proto, 'brands', 'ua.brands.get'),
    accessor(proto, 'mobile', 'ua.mobile.get'),
    accessor(proto, 'platform', 'ua.platform.get'),
    refProp(proto, 'getHighEntropyValues', 'ua.high', true),
    refProp(proto, 'toJSON', 'ua.json', true),
    {
      op: 'order', target: proto,
      keys: ['brands', 'mobile', 'platform', 'getHighEntropyValues', 'toJSON', 'constructor', { symbol: 'toStringTag' }],
    },
  ];
}

export function uaShape(input: Shape): Shape {
  const shape = navShape(input);
  if (shape.features.includes('ua')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'ua'].sort(),
    ops: [...shape.ops, ...operations()],
    support: {
      ...shape.support,
      'ua.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'ua.api': 'emulated',
    },
  }));
}

export const uaFeature: Feature = {
  id: 'ua',
  rev: '1',
  requires: ['nav'],
  build: ({ profile }) => {
    const data = profile.navigator.userAgentData;
    const json = data as unknown as JsonValue;
    return {
      binds: [
        { slot: 'ua.ctor', driver: 'ua', config: { op: 'illegal' } },
        { slot: 'ua.window', driver: 'ua', config: { op: 'node', id: 'ua.instance' } },
        { slot: 'ua.brands', driver: 'ua', config: { op: 'value', value: data.brands as unknown as JsonValue } },
        { slot: 'ua.mobile', driver: 'ua', config: { op: 'value', value: data.mobile } },
        { slot: 'ua.platform', driver: 'ua', config: { op: 'value', value: data.platform } },
        { slot: 'ua.high', driver: 'ua', config: { op: 'high', data: json } },
        { slot: 'ua.json', driver: 'ua', config: { op: 'json', data: json } },
      ],
      support: { 'ua.data': profile.evidence.navigator.fields['userAgentData.brands'] || 'derived' },
    };
  },
};

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError('ua Driver config invalid');
  return value;
}

function data(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError('ua data invalid');
  return value;
}

export const uaDriver: Driver = {
  open: (port) => ({
    call: (raw, _self, args) => {
      const item = config(raw);
      if (item.op === 'node') return port.node(String(item.id));
      if (item.op === 'value') return item.value !== null && typeof item.value === 'object' ? port.clone(item.value) : item.value;
      const ua = data(item.data);
      const brands = ua.brands ?? null;
      const mobile = ua.mobile ?? null;
      const platform = ua.platform ?? null;
      if (item.op === 'json') return port.clone({ brands, mobile, platform });
      if (item.op === 'high') {
        const output: Record<string, JsonValue> = { brands, mobile, platform };
        const hints = Array.isArray(args[0]) ? args[0] : [];
        for (const hint of hints) if (typeof hint === 'string' && hint in ua && !['brands', 'mobile', 'platform'].includes(hint)) output[hint] = ua[hint]!;
        return port.resolve(output);
      }
      throw new TypeError(`ua Driver op invalid:${String(item.op)}`);
    },
    construct: (raw) => {
      if (config(raw).op === 'illegal') throw port.error('TypeError', 'Illegal constructor');
      return undefined;
    },
  }),
};
