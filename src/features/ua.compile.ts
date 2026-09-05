import { describeCoverage } from './capabilities.js';
import type { JsonValue } from '../core/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, ctor, fn, refProp, tag } from './ops.js';

export function operations(): DraftOp[] {
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

export const uaFeature: Feature = {
  id: 'ua',
  describe: (_context, support) => describeCoverage(support, {
    'ua.api': 'partial',
    'ua.data': 'constant',
  }),
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
