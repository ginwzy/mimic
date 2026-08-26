import type { JsonValue, Shape } from '../core/types.js';
import type { DraftOp, FnPart } from '../shape/types.js';
import { extendShape, shapeSupport } from './extend.js';
import { globalsShape } from './globals.shape.js';
import { accessor, fn, fnShape, refProp, tag } from './ops.js';
import { PROTOS } from './dom.data.js';
import { SURFACES, type SurfaceId } from './dom.missing.data.js';

const NODE_KEYS = [
  'length', 'name', 'prototype',
  'ELEMENT_NODE', 'ATTRIBUTE_NODE', 'TEXT_NODE', 'CDATA_SECTION_NODE', 'ENTITY_REFERENCE_NODE', 'ENTITY_NODE',
  'PROCESSING_INSTRUCTION_NODE', 'COMMENT_NODE', 'DOCUMENT_NODE', 'DOCUMENT_TYPE_NODE', 'DOCUMENT_FRAGMENT_NODE',
  'NOTATION_NODE', 'DOCUMENT_POSITION_DISCONNECTED', 'DOCUMENT_POSITION_PRECEDING', 'DOCUMENT_POSITION_FOLLOWING',
  'DOCUMENT_POSITION_CONTAINS', 'DOCUMENT_POSITION_CONTAINED_BY', 'DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC',
] as const;

const EVENT_KEYS = ['length', 'name', 'prototype', 'NONE', 'CAPTURING_PHASE', 'AT_TARGET', 'BUBBLING_PHASE'] as const;

const token = (owner: string, key: string, part: FnPart): string => `${owner}\u0000${key}\u0000${part}`;

const DEFERRED_WRITES = [
  token('window.Navigator.prototype', 'connection', 'get'),
  token('window.Navigator.prototype', 'storage', 'get'),
  token('window.Navigator.prototype', 'mediaDevices', 'get'),
  token('window.Navigator.prototype', 'serviceWorker', 'get'),
  token('window.Navigator.prototype', 'permissions', 'get'),
  token('window.Document.prototype', 'fonts', 'get'),
  token('window.XMLHttpRequest.prototype', 'send', 'value'),
  token('window.Navigator.prototype', 'sendBeacon', 'value'),
] as const;

function record(value: JsonValue): Record<string, JsonValue> | undefined {
  return value !== null && !Array.isArray(value) && typeof value === 'object' ? value : undefined;
}

function owned(shape: Shape): Set<string> {
  const output = new Set<string>();
  for (const raw of shape.ops) {
    const op = record(raw);
    const target = op && record(op.target as JsonValue);
    if (!op || !target || typeof target.path !== 'string') continue;
    if ((op.op === 'prop' || op.op === 'drop') && typeof op.key === 'string') {
      for (const part of ['value', 'get', 'set'] as const) output.add(token(target.path, op.key, part));
      continue;
    }
    if (op.op !== 'fn') continue;
    if (typeof op.key === 'string' && (op.part === 'value' || op.part === 'get' || op.part === 'set')) {
      output.add(token(target.path, op.key, op.part));
      continue;
    }
    const split = target.path.lastIndexOf('.');
    if (split > 'window'.length) output.add(token(target.path.slice(0, split), target.path.slice(split + 1), 'value'));
  }
  return output;
}

function operations(shape: Shape): DraftOp[] {
  const writes = owned(shape);
  for (const write of DEFERRED_WRITES) writes.add(write);
  const ops: DraftOp[] = [];
  const add = (owner: string, key: string, part: FnPart, length: number): void => {
    if (writes.has(token(owner, key, part))) return;
    ops.push({
      op: 'fn',
      target: { path: owner },
      key,
      part,
      shape: fnShape(part === 'value' ? key : `${part} ${key}`, length),
    });
  };
  for (const proto of PROTOS) {
    for (const [rawLength, names] of Object.entries(proto.m)) {
      const length = Number(rawLength);
      for (const name of names || []) add(proto.owner, name, 'value', length);
    }
    for (const name of proto.g) add(proto.owner, name, 'get', 0);
    for (const name of proto.s) add(proto.owner, name, 'set', 1);
  }
  if (shape.target.form === 'mobile') {
    for (const owner of ['window.Document.prototype', 'window.HTMLElement.prototype']) {
      for (const name of ['ontouchcancel', 'ontouchend', 'ontouchmove', 'ontouchstart']) {
        add(owner, name, 'get', 0);
        add(owner, name, 'set', 1);
      }
    }
  }
  ops.push(...interfaceOps(shape));
  ops.push(...globalOps(shape));
  ops.push(...missingOps(shape, writes));
  return ops;
}

function globalOps(shape: Shape): DraftOp[] {
  const ops: DraftOp[] = [
    { op: 'alloc', id: 'dom.idb.proto', kind: 'object' },
    { op: 'alloc', id: 'dom.idb.instance', kind: 'object' },
    {
      op: 'alloc', id: 'dom.idb.ctor', kind: 'function',
      shape: fnShape('IDBFactory', 0, true, true), prototype: { node: 'dom.idb.proto' },
    },
    { op: 'proto', target: { node: 'dom.idb.proto' }, value: { path: 'window.Object.prototype' } },
    { op: 'proto', target: { node: 'dom.idb.instance' }, value: { node: 'dom.idb.proto' } },
    refProp({ path: 'window' }, 'IDBFactory', 'dom.idb.ctor'),
    refProp({ path: 'window' }, 'indexedDB', 'dom.idb.instance', true),
    refProp({ node: 'dom.idb.proto' }, 'constructor', 'dom.idb.ctor'),
    tag({ node: 'dom.idb.proto' }, 'IDBFactory'),
  ];
  if (shape.target.host === 'webview') {
    ops.push(
      { op: 'alloc', id: 'dom.media', kind: 'object' },
      refProp({ node: 'nav.instance' }, 'mediaSession', 'dom.media', true),
    );
  }
  // Worker / OffscreenCanvas / RTC long-standing on Chrome/WebView.
  // RTC was wrongly gated to chrome≥149 — real Android Chrome 138 has typeof RTCPeerConnection === 'function';
  // BMS capability vectors (iV442/media + dual multi-id table) probe these surfaces.
  if (shape.target.host === 'chrome' || shape.target.host === 'webview') {
    ops.push(...workerOps(), ...blobUrlOps(), ...offscreenCanvasOps(), ...rtcPeerConnectionOps());
    ops.push(...mediaCanPlayOps());
  }
  return ops;
}

function rtcPeerConnectionOps(): DraftOp[] {
  const prefix = 'dom.RTCPeerConnection';
  return [
    { op: 'alloc', id: `${prefix}.proto`, kind: 'object' },
    {
      op: 'alloc', id: `${prefix}.ctor`, kind: 'function',
      shape: fnShape('RTCPeerConnection', 0, true, true), prototype: { node: `${prefix}.proto` },
    },
    { op: 'proto', target: { node: `${prefix}.proto` }, value: { path: 'window.EventTarget.prototype' } },
    refProp({ path: 'window' }, 'RTCPeerConnection', `${prefix}.ctor`),
    refProp({ node: `${prefix}.proto` }, 'constructor', `${prefix}.ctor`),
    tag({ node: `${prefix}.proto` }, 'RTCPeerConnection'),
    { op: 'alloc', id: `${prefix}.generate`, kind: 'function', shape: fnShape('generateCertificate', 1) },
    refProp({ node: `${prefix}.ctor` }, 'generateCertificate', `${prefix}.generate`),
  ];
}

/**
 * jsdom canPlayType always returns "". Chrome Android reports "probably"/"maybe"
 * for common codecs; BMS packs six probes into iV442 (real all 1s when supported).
 */
function mediaCanPlayOps(): DraftOp[] {
  return [
    fn('dom.media.canPlayType', 'dom.media.canPlayType', 'canPlayType', 1),
    refProp({ path: 'window.HTMLMediaElement.prototype' }, 'canPlayType', 'dom.media.canPlayType', true),
  ];
}

/** jsdom URL lacks createObjectURL; BMS often does new Worker(URL.createObjectURL(blob)). */
function blobUrlOps(): DraftOp[] {
  return [
    fn('dom.url.createObjectURL', 'dom.url.createObjectURL', 'createObjectURL', 1),
    fn('dom.url.revokeObjectURL', 'dom.url.revokeObjectURL', 'revokeObjectURL', 1),
    refProp({ path: 'window.URL' }, 'createObjectURL', 'dom.url.createObjectURL', true),
    refProp({ path: 'window.URL' }, 'revokeObjectURL', 'dom.url.revokeObjectURL', true),
  ];
}

/**
 * OffscreenCanvas — jsdom has none. BMS GPU fingerprint often uses
 * `new OffscreenCanvas(w,h).getContext('webgl')` rather than HTMLCanvasElement.
 * Implementation delegates to a hidden HTML canvas so webgl/2d drivers apply.
 */
function offscreenCanvasOps(): DraftOp[] {
  const proto = { node: 'dom.OffscreenCanvas.proto' } as const;
  return [
    { op: 'alloc', id: 'dom.OffscreenCanvas.proto', kind: 'object' },
    {
      op: 'alloc', id: 'dom.OffscreenCanvas.ctor', kind: 'function', slot: 'dom.OffscreenCanvas.ctor',
      shape: fnShape('OffscreenCanvas', 0, true, true), prototype: proto,
    },
    { op: 'proto', target: proto, value: { path: 'window.Object.prototype' } },
    refProp({ path: 'window' }, 'OffscreenCanvas', 'dom.OffscreenCanvas.ctor'),
    refProp(proto, 'constructor', 'dom.OffscreenCanvas.ctor'),
    tag(proto, 'OffscreenCanvas'),
    fn('dom.OffscreenCanvas.getContext', 'dom.OffscreenCanvas.getContext', 'getContext', 1),
    fn('dom.OffscreenCanvas.convertToBlob', 'dom.OffscreenCanvas.convertToBlob', 'convertToBlob', 0),
    fn('dom.OffscreenCanvas.width.get', 'dom.OffscreenCanvas.width.get', 'get width'),
    fn('dom.OffscreenCanvas.width.set', 'dom.OffscreenCanvas.width.set', 'set width', 1),
    fn('dom.OffscreenCanvas.height.get', 'dom.OffscreenCanvas.height.get', 'get height'),
    fn('dom.OffscreenCanvas.height.set', 'dom.OffscreenCanvas.height.set', 'set height', 1),
    refProp(proto, 'getContext', 'dom.OffscreenCanvas.getContext', true),
    refProp(proto, 'convertToBlob', 'dom.OffscreenCanvas.convertToBlob', true),
    accessor(proto, 'width', 'dom.OffscreenCanvas.width.get', 'dom.OffscreenCanvas.width.set'),
    accessor(proto, 'height', 'dom.OffscreenCanvas.height.get', 'dom.OffscreenCanvas.height.set'),
    {
      op: 'order', target: proto,
      keys: ['width', 'height', 'getContext', 'convertToBlob', 'constructor', { symbol: 'toStringTag' }],
    },
  ];
}

/** Constructible Worker surface (EventTarget); blob/data scripts run same-process. */
function workerOps(): DraftOp[] {
  const proto = { node: 'dom.Worker.proto' } as const;
  const shared = { node: 'dom.SharedWorker.proto' } as const;
  return [
    { op: 'alloc', id: 'dom.Worker.proto', kind: 'object' },
    {
      op: 'alloc', id: 'dom.Worker.ctor', kind: 'function', slot: 'dom.Worker.ctor',
      shape: fnShape('Worker', 1, true, true), prototype: proto,
    },
    { op: 'proto', target: proto, value: { path: 'window.EventTarget.prototype' } },
    refProp({ path: 'window' }, 'Worker', 'dom.Worker.ctor'),
    refProp(proto, 'constructor', 'dom.Worker.ctor'),
    tag(proto, 'Worker'),
    fn('dom.Worker.postMessage', 'dom.Worker.postMessage', 'postMessage', 1),
    fn('dom.Worker.terminate', 'dom.Worker.terminate', 'terminate', 0),
    fn('dom.Worker.onmessage.get', 'dom.Worker.onmessage.get', 'get onmessage'),
    fn('dom.Worker.onmessage.set', 'dom.Worker.onmessage.set', 'set onmessage', 1),
    fn('dom.Worker.onerror.get', 'dom.Worker.onerror.get', 'get onerror'),
    fn('dom.Worker.onerror.set', 'dom.Worker.onerror.set', 'set onerror', 1),
    fn('dom.Worker.onmessageerror.get', 'dom.Worker.onmessageerror.get', 'get onmessageerror'),
    fn('dom.Worker.onmessageerror.set', 'dom.Worker.onmessageerror.set', 'set onmessageerror', 1),
    refProp(proto, 'postMessage', 'dom.Worker.postMessage', true),
    refProp(proto, 'terminate', 'dom.Worker.terminate', true),
    accessor(proto, 'onmessage', 'dom.Worker.onmessage.get', 'dom.Worker.onmessage.set'),
    accessor(proto, 'onerror', 'dom.Worker.onerror.get', 'dom.Worker.onerror.set'),
    accessor(proto, 'onmessageerror', 'dom.Worker.onmessageerror.get', 'dom.Worker.onmessageerror.set'),
    {
      op: 'order', target: proto,
      keys: [
        'postMessage', 'terminate', 'onmessage', 'onerror', 'onmessageerror',
        'constructor', { symbol: 'toStringTag' },
      ],
    },
    // BMS dual-id second table: SharedWorker + port (status 260 if ctor.name !== "SharedWorker").
    { op: 'alloc', id: 'dom.SharedWorker.proto', kind: 'object' },
    {
      op: 'alloc', id: 'dom.SharedWorker.ctor', kind: 'function', slot: 'dom.SharedWorker.ctor',
      shape: fnShape('SharedWorker', 1, true, true), prototype: shared,
    },
    { op: 'proto', target: shared, value: { path: 'window.EventTarget.prototype' } },
    refProp({ path: 'window' }, 'SharedWorker', 'dom.SharedWorker.ctor'),
    refProp(shared, 'constructor', 'dom.SharedWorker.ctor'),
    tag(shared, 'SharedWorker'),
    fn('dom.SharedWorker.port.get', 'dom.SharedWorker.port.get', 'get port'),
    fn('dom.SharedWorker.onerror.get', 'dom.SharedWorker.onerror.get', 'get onerror'),
    fn('dom.SharedWorker.onerror.set', 'dom.SharedWorker.onerror.set', 'set onerror', 1),
    accessor(shared, 'port', 'dom.SharedWorker.port.get'),
    accessor(shared, 'onerror', 'dom.SharedWorker.onerror.get', 'dom.SharedWorker.onerror.set'),
    {
      op: 'order', target: shared,
      keys: ['port', 'onerror', 'constructor', { symbol: 'toStringTag' }],
    },
  ];
}

function surface(shape: Shape): SurfaceId {
  if (shape.target.host === 'webview' || shape.target.platform === 'android') return 'wv138';
  if (shape.target.platform === 'linux') return 'c143';
  return shape.target.version >= 149 ? 'c149' : 'c148';
}

function missingOps(shape: Shape, writes: ReadonlySet<string>): DraftOp[] {
  const ops: DraftOp[] = [];
  let sequence = 0;
  for (const proto of SURFACES[surface(shape)]) {
    for (const missing of proto.missing) {
      const desc = missing.desc;
      if (desc.kind === 'data') {
        if (writes.has(token(proto.owner, missing.key, 'value'))) continue;
        if (!desc.fn) throw new TypeError(`DOM data value is not callable:${proto.owner}.${missing.key}`);
        const id = `dom.missing.${sequence++}`;
        ops.push(
          { op: 'alloc', id, kind: 'function', shape: desc.fn },
          {
            op: 'prop', target: { path: proto.owner }, key: missing.key,
            desc: {
              kind: 'data', value: { ref: { node: id } },
              writable: desc.flags.writable === true,
              enumerable: desc.flags.enumerable,
              configurable: desc.flags.configurable,
            },
          },
        );
        continue;
      }
      if (writes.has(token(proto.owner, missing.key, 'get')) || writes.has(token(proto.owner, missing.key, 'set'))) continue;
      const get = desc.get ? `dom.missing.${sequence++}.get` : undefined;
      const set = desc.set ? `dom.missing.${sequence++}.set` : undefined;
      if (get) ops.push({ op: 'alloc', id: get, kind: 'function', shape: desc.get! });
      if (set) ops.push({ op: 'alloc', id: set, kind: 'function', shape: desc.set! });
      ops.push({
        op: 'prop', target: { path: proto.owner }, key: missing.key,
        desc: {
          kind: 'accessor',
          ...(get ? { get: { node: get } } : {}),
          ...(set ? { set: { node: set } } : {}),
          enumerable: desc.flags.enumerable,
          configurable: desc.flags.configurable,
        },
      });
    }
    ops.push({
      op: 'order', target: { path: proto.owner },
      keys: [...proto.keys, ...proto.symbols.map((symbol) => ({ symbol }))],
    });
  }
  return ops;
}

function interfaceOps(shape: Shape): DraftOp[] {
  const ops: DraftOp[] = [];
  const statics = ['parseHTMLUnsafe', ...(shape.target.version >= 148 ? ['parseHTML'] : [])];
  for (const name of statics) {
    const id = `dom.Document.${name}`;
    ops.push(
      { op: 'alloc', id, kind: 'function', shape: fnShape(name, 1) },
      refProp({ path: 'window.Document' }, name, id),
    );
  }

  const constructors: ReadonlyArray<readonly [string, number, readonly string[]]> = [
    ['Navigator', 0, ['length', 'name', 'prototype']],
    ['Document', 0, ['length', 'name', 'prototype', ...statics]],
    ['Node', 0, NODE_KEYS],
    ['EventTarget', 0, ['length', 'name', 'prototype']],
    ['Element', 0, ['length', 'name', 'prototype']],
    ['HTMLElement', 0, ['length', 'name', 'prototype']],
    ['HTMLDivElement', 0, ['length', 'name', 'prototype']],
    ['Event', 1, EVENT_KEYS],
  ];
  for (const [name, length, keys] of constructors) {
    ops.push({
      op: 'fn',
      target: { path: `window.${name}` },
      shape: { name, length, native: true, constructable: true, hasPrototype: true, keys },
    });
  }
  ops.push(
    { op: 'proto', target: { path: 'window.Navigator.prototype' }, value: { path: 'window.Object.prototype' } },
    { op: 'proto', target: { path: 'window.Event.prototype' }, value: { path: 'window.Object.prototype' } },
  );
  return ops;
}

export function domShape(input: Shape): Shape {
  const shape = globalsShape(input);
  return extendShape(shape, 'dom', operations(shape), {
    'dom.shape': shapeSupport(shape),
    'dom.api': 'shape-only',
  });
}

