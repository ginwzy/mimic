import { describeCoverage } from './capabilities.js';
import type { DraftOp } from '../shape/types.js';
import type { BuiltinFeature } from './types.js';
import { accessor, fn, fnShape, refProp, tag } from './ops.js';
import { RESPONSE_PROTO, XHR, XHR_SEND, NAV, BEACON, FETCH, ARRAY_BUFFER, type Mode, type NetConfig } from './net.shared.js';

export function operations(): DraftOp[] {
  return [
    { op: 'alloc', id: RESPONSE_PROTO, kind: 'object' },
    {
      op: 'alloc', id: 'net.response.ctor', kind: 'function', slot: 'net.response.ctor',
      shape: fnShape('Response', 0, true, true), prototype: { node: RESPONSE_PROTO },
    },
    fn('net.xhr', 'net.xhr', 'send'),
    fn('net.beacon', 'net.beacon', 'sendBeacon', 1),
    fn('net.fetch', 'net.fetch', 'fetch', 1),
    fn('net.response.ok', 'net.response.ok', 'get ok'),
    fn('net.response.status', 'net.response.status', 'get status'),
    fn('net.response.status-text', 'net.response.statusText', 'get statusText'),
    fn('net.response.text', 'net.response.text', 'text'),
    fn('net.response.json', 'net.response.json', 'json'),
    fn('net.response.array-buffer', 'net.response.arrayBuffer', 'arrayBuffer'),
    { op: 'proto', target: { node: RESPONSE_PROTO }, value: { path: 'window.Object.prototype' } },
    refProp({ path: 'window' }, 'Response', 'net.response.ctor'),
    refProp({ node: RESPONSE_PROTO }, 'constructor', 'net.response.ctor'),
    tag({ node: RESPONSE_PROTO }, 'Response'),
    accessor({ node: RESPONSE_PROTO }, 'ok', 'net.response.ok'),
    accessor({ node: RESPONSE_PROTO }, 'status', 'net.response.status'),
    accessor({ node: RESPONSE_PROTO }, 'statusText', 'net.response.status-text'),
    refProp({ node: RESPONSE_PROTO }, 'text', 'net.response.text', true),
    refProp({ node: RESPONSE_PROTO }, 'json', 'net.response.json', true),
    refProp({ node: RESPONSE_PROTO }, 'arrayBuffer', 'net.response.array-buffer', true),
    refProp({ path: 'window.XMLHttpRequest.prototype' }, 'send', 'net.xhr', true),
    refProp({ path: 'window.Navigator.prototype' }, 'sendBeacon', 'net.beacon', true),
    refProp({ path: 'window' }, 'fetch', 'net.fetch', true),
    {
      op: 'order', target: { node: RESPONSE_PROTO },
      keys: ['ok', 'status', 'statusText', 'text', 'json', 'arrayBuffer', 'constructor', { symbol: 'toStringTag' }],
    },
  ];
}

export const netFeature: BuiltinFeature = {
  id: 'net',
  jobKeys: ['kind'],
  describe: (_context, support) => describeCoverage(support, {
    'net.api': 'partial',
    'net.capture': 'partial',
    'net.forward': 'partial',
  }),
  rev: '1',
  requires: ['dom'],
  reserves: [
    { path: 'window.XMLHttpRequest.prototype', key: 'send', part: 'value' },
    { path: 'window.Navigator.prototype', key: 'sendBeacon', part: 'value' },
  ],
  build: ({ job }) => {
    const mode: Mode = job.kind === 'capture' ? 'capture' : 'forward';
    return {
      binds: [
        {
          slot: 'net.xhr', driver: 'net', config: { op: 'request', via: 'xhr', mode },
          sources: [XHR, XHR_SEND],
        },
        {
          slot: 'net.beacon', driver: 'net', config: { op: 'request', via: 'beacon', mode },
          sources: [NAV, BEACON],
        },
        {
          slot: 'net.fetch', driver: 'net', config: { op: 'request', via: 'fetch', mode },
          sources: [FETCH],
        },
        { slot: 'net.response.ctor', driver: 'net', config: { op: 'response-ctor' } },
        { slot: 'net.response.ok', driver: 'net', config: { op: 'response-field', field: 'ok' } },
        { slot: 'net.response.status', driver: 'net', config: { op: 'response-field', field: 'status' } },
        { slot: 'net.response.statusText', driver: 'net', config: { op: 'response-field', field: 'statusText' } },
        { slot: 'net.response.text', driver: 'net', config: { op: 'response-body', kind: 'text' } },
        { slot: 'net.response.json', driver: 'net', config: { op: 'response-body', kind: 'json' } },
        {
          slot: 'net.response.arrayBuffer', driver: 'net', config: { op: 'response-body', kind: 'arrayBuffer' },
          sources: [ARRAY_BUFFER],
        },
      ] satisfies { slot: string; driver: string; config: NetConfig; sources?: string[] }[],
      support: {
        'net.capture': mode === 'capture' ? 'emulated' : 'unsupported',
        'net.forward': mode === 'forward' ? 'emulated' : 'unsupported',
      },
    };
  },
};
