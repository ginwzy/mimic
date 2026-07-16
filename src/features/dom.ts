import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Shape } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import type { DraftOp, Feature, FnPart } from '../shape/types.js';
import { globalsShape } from './globals.js';
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
  // Worker is long-standing on Chrome/WebView; BMS GPU/sensor paths gate on typeof Worker.
  // Previously only webview or chrome≥149 — android-chrome v138 profiles had no Worker → silent probe skip.
  if (shape.target.host === 'chrome' || shape.target.host === 'webview') {
    ops.push(...workerOps(), ...blobUrlOps(), ...offscreenCanvasOps());
  }
  if (shape.target.host === 'webview' || shape.target.version >= 149) {
    const prefix = 'dom.RTCPeerConnection';
    ops.push(
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
    );
  }
  return ops;
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

/** Constructible Worker surface (EventTarget); script body is not executed — enough for presence gates. */
function workerOps(): DraftOp[] {
  const proto = { node: 'dom.Worker.proto' } as const;
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
  if (shape.features.includes('dom')) return shape;
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'dom'].sort(),
    ops: [...shape.ops, ...operations(shape)],
    support: {
      ...shape.support,
      'dom.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'dom.api': 'shape-only',
    },
  }));
}

export const domFeature: Feature = {
  id: 'dom',
  rev: '3',
  requires: ['globals'],
  build: () => ({
    binds: [
      {
        slot: 'dom.Worker.ctor', driver: 'dom', config: { op: 'worker' },
        sources: [
          'window.EventTarget',
          'window.Function',
          'window.MessageEvent',
          'window.setTimeout',
        ],
      },
      { slot: 'dom.Worker.postMessage', driver: 'dom', config: { op: 'worker-post' } },
      { slot: 'dom.Worker.terminate', driver: 'dom', config: { op: 'worker-terminate' } },
      { slot: 'dom.Worker.onmessage.get', driver: 'dom', config: { op: 'handler-get', name: 'onmessage' } },
      { slot: 'dom.Worker.onmessage.set', driver: 'dom', config: { op: 'handler-set', name: 'onmessage' } },
      { slot: 'dom.Worker.onerror.get', driver: 'dom', config: { op: 'handler-get', name: 'onerror' } },
      { slot: 'dom.Worker.onerror.set', driver: 'dom', config: { op: 'handler-set', name: 'onerror' } },
      { slot: 'dom.Worker.onmessageerror.get', driver: 'dom', config: { op: 'handler-get', name: 'onmessageerror' } },
      { slot: 'dom.Worker.onmessageerror.set', driver: 'dom', config: { op: 'handler-set', name: 'onmessageerror' } },
      { slot: 'dom.url.createObjectURL', driver: 'dom', config: { op: 'create-object-url' } },
      { slot: 'dom.url.revokeObjectURL', driver: 'dom', config: { op: 'revoke-object-url' } },
      {
        slot: 'dom.OffscreenCanvas.ctor', driver: 'dom', config: { op: 'offscreen' },
        // Function source builds a realm thunk so we can call document.createElement without binding document itself.
        sources: ['window.Function', 'window.HTMLCanvasElement'],
      },
      { slot: 'dom.OffscreenCanvas.getContext', driver: 'dom', config: { op: 'offscreen-context' } },
      {
        slot: 'dom.OffscreenCanvas.convertToBlob', driver: 'dom', config: { op: 'offscreen-blob' },
        sources: ['window.Blob'],
      },
      { slot: 'dom.OffscreenCanvas.width.get', driver: 'dom', config: { op: 'offscreen-dim-get', name: 'width' } },
      { slot: 'dom.OffscreenCanvas.width.set', driver: 'dom', config: { op: 'offscreen-dim-set', name: 'width' } },
      { slot: 'dom.OffscreenCanvas.height.get', driver: 'dom', config: { op: 'offscreen-dim-get', name: 'height' } },
      { slot: 'dom.OffscreenCanvas.height.set', driver: 'dom', config: { op: 'offscreen-dim-set', name: 'height' } },
    ],
    support: {
      'dom.worker': 'emulated', // blob:/data: scripts run same-process; no OS thread
      'dom.blob-url': 'emulated',
      'dom.offscreencanvas': 'emulated',
    },
  }),
};

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || typeof value.op !== 'string') {
    throw new TypeError('dom Driver config invalid');
  }
  return value;
}

function asObject(port: Port, value: unknown): object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw port.error('TypeError', 'Illegal invocation');
  }
  return value;
}

type BlobEntry = {
  blob: unknown;
  text: string | null;
  ready: Promise<string>;
};

type WorkerState = {
  terminated: boolean;
  main: object;
  scope: object | null;
  scriptUrl: string;
};

/** Same-process Worker: blob/data scripts run in a with(self) scope; postMessage is bridged. */
export const domDriver: Driver = {
  open: (port) => {
    const handlers = new WeakMap<object, Map<string, unknown>>();
    const offscreens = new WeakMap<object, { canvas: object }>();
    const workers = new WeakMap<object, WorkerState>();
    const eventTarget = port.source('window.EventTarget');
    const HTMLCanvasElement = port.source('window.HTMLCanvasElement');
    const FunctionCtor = port.source('window.Function');
    const MessageEventCtor = port.source('window.MessageEvent');
    const setTimeoutFn = port.source('window.setTimeout');
    const blobUrls = new Map<string, BlobEntry>();
    let blobSeq = 0;
    let canvasMaker: (() => object) | undefined;

    const offscreenOf = (self: unknown): { canvas: object } => {
      const target = asObject(port, self);
      const state = offscreens.get(target);
      if (!state) throw port.error('TypeError', 'Illegal invocation');
      return state;
    };

    const makeCanvas = (): object => {
      if (!canvasMaker) {
        if (typeof FunctionCtor !== 'function') {
          throw port.error('TypeError', 'Function is unavailable');
        }
        canvasMaker = Reflect.construct(FunctionCtor, [
          'return document.createElement("canvas")',
        ]) as () => object;
      }
      const canvas = Reflect.apply(canvasMaker, undefined, []) as object;
      if (typeof HTMLCanvasElement === 'function'
        && !Reflect.apply(Function.prototype[Symbol.hasInstance], HTMLCanvasElement, [canvas])) {
        throw port.error('TypeError', 'Failed to create canvas for OffscreenCanvas');
      }
      return canvas;
    };

    const realmEval = <T>(expression: string): T => {
      if (typeof FunctionCtor !== 'function') {
        throw port.error('TypeError', 'Function is unavailable');
      }
      const fn = Reflect.construct(FunctionCtor, [`return (${expression});`]) as () => T;
      return Reflect.apply(fn, undefined, []) as T;
    };

    const cloneData = (value: unknown): unknown => {
      if (value === undefined) return null;
      try {
        return JSON.parse(JSON.stringify(value)) as unknown;
      } catch {
        return null;
      }
    };

    const deliverMessage = (target: object, data: unknown): void => {
      const payload = cloneData(data);
      let event: object;
      if (typeof MessageEventCtor === 'function') {
        try {
          event = Reflect.construct(MessageEventCtor, ['message', { data: payload }]) as object;
        } catch {
          event = { type: 'message', data: payload } as object;
        }
      } else {
        event = { type: 'message', data: payload } as object;
      }
      const mapped = handlers.get(target)?.get('onmessage');
      const own = Reflect.get(target, 'onmessage');
      for (const handler of [mapped, own]) {
        if (typeof handler === 'function') {
          try {
            Reflect.apply(handler as Function, target, [event]);
          } catch {
            /* worker onmessage errors are isolated */
          }
        }
      }
      const dispatch = Reflect.get(target, 'dispatchEvent');
      if (typeof dispatch === 'function') {
        try {
          Reflect.apply(dispatch, target, [event]);
        } catch {
          /* ignore listener errors */
        }
      }
    };

    const fireWorkerError = (main: object, error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error);
      const own = handlers.get(main)?.get('onerror') ?? Reflect.get(main, 'onerror');
      if (typeof own === 'function') {
        try {
          Reflect.apply(own as Function, main, [message]);
        } catch {
          /* ignore */
        }
      }
      const ErrorEventCtor = realmEval<unknown>('typeof ErrorEvent === "function" ? ErrorEvent : null');
      if (typeof ErrorEventCtor === 'function') {
        try {
          const ev = Reflect.construct(ErrorEventCtor as Function, ['error', { message }]);
          const dispatch = Reflect.get(main, 'dispatchEvent');
          if (typeof dispatch === 'function') Reflect.apply(dispatch, main, [ev]);
        } catch {
          /* ignore */
        }
      }
    };

    const readBlobText = (blob: unknown): Promise<string> => {
      if (blob !== null && typeof blob === 'object' && typeof Reflect.get(blob, 'text') === 'function') {
        return Promise.resolve(Reflect.apply(Reflect.get(blob, 'text') as Function, blob, []) as Promise<string>);
      }
      return Promise.resolve(String(blob ?? ''));
    };

    const decodeDataUrl = (url: string): string => {
      const match = /^data:([^,]*?),([\s\S]*)$/i.exec(url);
      if (!match) {
        throw port.error('TypeError', `Failed to construct 'Worker': invalid data URL`);
      }
      const meta = match[1] ?? '';
      const body = match[2] ?? '';
      if (/;base64/i.test(meta)) {
        return Buffer.from(body, 'base64').toString('utf8');
      }
      try {
        return decodeURIComponent(body);
      } catch {
        return body;
      }
    };

    const resolveScript = async (url: string): Promise<string> => {
      if (url.startsWith('blob:')) {
        const entry = blobUrls.get(url);
        if (!entry) {
          throw port.error('TypeError', `Failed to load worker script: unknown blob URL`);
        }
        if (entry.text !== null) return entry.text;
        const text = await entry.ready;
        entry.text = text;
        return text;
      }
      if (url.startsWith('data:')) return decodeDataUrl(url);
      throw port.error(
        'TypeError',
        `Failed to construct 'Worker': only blob: and data: script URLs are supported (got ${url.slice(0, 64)})`,
      );
    };

    const runInWorkerScope = (scope: object, code: string): void => {
      if (typeof FunctionCtor !== 'function') {
        throw port.error('TypeError', 'Function is unavailable');
      }
      // Non-strict with(self): bare postMessage/navigator/OffscreenCanvas resolve on the worker scope.
      // (with is illegal under "use strict".)
      const runner = Reflect.construct(FunctionCtor, [
        'self',
        `with (self) {\n${code}\n}\n`,
      ]) as (self: object) => void;
      Reflect.apply(runner, scope, [scope]);
    };

    const bootWorker = (state: WorkerState, code: string): void => {
      if (state.terminated) return;
      if (typeof eventTarget !== 'function') {
        throw port.error('TypeError', 'EventTarget is unavailable');
      }
      const scope = Reflect.construct(eventTarget, []) as object;
      state.scope = scope;
      workers.set(scope, state);

      const postFromWorker = (data: unknown): void => {
        if (state.terminated) return;
        deliverMessage(state.main, data);
      };
      const closeWorker = (): void => {
        state.terminated = true;
      };
      const importScripts = (...urls: unknown[]): void => {
        for (const item of urls) {
          const href = String(item);
          let source: string;
          if (href.startsWith('blob:')) {
            const entry = blobUrls.get(href);
            if (!entry || entry.text === null) {
              throw port.error('TypeError', `importScripts failed: blob not ready (${href.slice(0, 48)})`);
            }
            source = entry.text;
          } else if (href.startsWith('data:')) {
            source = decodeDataUrl(href);
          } else {
            throw port.error('TypeError', `importScripts only supports blob:/data: URLs`);
          }
          runInWorkerScope(scope, source);
        }
      };

      // Mirror common DedicatedWorkerGlobalScope bindings from the page realm.
      Reflect.set(scope, 'self', scope);
      Reflect.set(scope, 'globalThis', scope);
      Reflect.set(scope, 'postMessage', postFromWorker);
      Reflect.set(scope, 'close', closeWorker);
      Reflect.set(scope, 'importScripts', importScripts);
      Reflect.set(scope, 'navigator', realmEval<unknown>('navigator'));
      Reflect.set(scope, 'OffscreenCanvas', realmEval<unknown>('typeof OffscreenCanvas === "function" ? OffscreenCanvas : undefined'));
      Reflect.set(scope, 'WebGLRenderingContext', realmEval<unknown>('typeof WebGLRenderingContext === "function" ? WebGLRenderingContext : undefined'));
      Reflect.set(scope, 'WebGL2RenderingContext', realmEval<unknown>('typeof WebGL2RenderingContext === "function" ? WebGL2RenderingContext : undefined'));
      Reflect.set(scope, 'Blob', realmEval<unknown>('typeof Blob === "function" ? Blob : undefined'));
      Reflect.set(scope, 'URL', realmEval<unknown>('typeof URL === "function" ? URL : undefined'));
      Reflect.set(scope, 'console', realmEval<unknown>('console'));
      Reflect.set(scope, 'setTimeout', realmEval<unknown>('setTimeout'));
      Reflect.set(scope, 'clearTimeout', realmEval<unknown>('clearTimeout'));
      Reflect.set(scope, 'setInterval', realmEval<unknown>('setInterval'));
      Reflect.set(scope, 'clearInterval', realmEval<unknown>('clearInterval'));
      Reflect.set(scope, 'atob', realmEval<unknown>('typeof atob === "function" ? atob : undefined'));
      Reflect.set(scope, 'btoa', realmEval<unknown>('typeof btoa === "function" ? btoa : undefined'));
      Reflect.set(scope, 'location', {
        href: state.scriptUrl,
        toString() {
          return state.scriptUrl;
        },
      });

      try {
        runInWorkerScope(scope, code);
      } catch (error) {
        fireWorkerError(state.main, error);
      }
    };

    const schedule = (task: () => void): void => {
      if (typeof setTimeoutFn === 'function') {
        Reflect.apply(setTimeoutFn as Function, undefined, [task, 0]);
        return;
      }
      queueMicrotask(task);
    };

    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'void') return undefined;
        if (item.op === 'create-object-url') {
          const id = `blob:https://localhost/${(++blobSeq).toString(16)}-${port.now()}`;
          const blob = args[0];
          const entry: BlobEntry = {
            blob,
            text: null,
            ready: readBlobText(blob).then((text) => {
              entry.text = text;
              return text;
            }),
          };
          // Kick off text materialization immediately so importScripts/new Worker can often sync-read.
          void entry.ready.catch(() => undefined);
          blobUrls.set(id, entry);
          return id;
        }
        if (item.op === 'revoke-object-url') {
          blobUrls.delete(String(args[0]));
          return undefined;
        }
        if (item.op === 'handler-get') {
          if ((typeof self !== 'object' && typeof self !== 'function') || self === null) return null;
          return handlers.get(self)?.get(String(item.name)) ?? null;
        }
        if (item.op === 'handler-set') {
          if ((typeof self !== 'object' && typeof self !== 'function') || self === null) return undefined;
          let values = handlers.get(self);
          if (!values) {
            values = new Map();
            handlers.set(self, values);
          }
          values.set(String(item.name), args[0] ?? null);
          return undefined;
        }
        if (item.op === 'worker-post') {
          const main = asObject(port, self);
          const state = workers.get(main);
          if (!state) throw port.error('TypeError', 'Illegal invocation');
          if (state.terminated || !state.scope) return undefined;
          deliverMessage(state.scope, args[0]);
          return undefined;
        }
        if (item.op === 'worker-terminate') {
          const main = asObject(port, self);
          const state = workers.get(main);
          if (!state) throw port.error('TypeError', 'Illegal invocation');
          state.terminated = true;
          return undefined;
        }
        if (item.op === 'offscreen-context') {
          const { canvas } = offscreenOf(self);
          const getContext = Reflect.get(Object.getPrototypeOf(canvas) as object, 'getContext');
          if (typeof getContext !== 'function') return null;
          return Reflect.apply(getContext, canvas, args);
        }
        if (item.op === 'offscreen-blob') {
          offscreenOf(self);
          const BlobCtor = port.source('window.Blob');
          if (typeof BlobCtor !== 'function') return port.resolve(null as unknown as JsonValue);
          const blob = Reflect.construct(BlobCtor, [[], { type: 'image/png' }]);
          return Promise.resolve(blob);
        }
        if (item.op === 'offscreen-dim-get') {
          const { canvas } = offscreenOf(self);
          return Number(Reflect.get(canvas, String(item.name))) || 0;
        }
        if (item.op === 'offscreen-dim-set') {
          const { canvas } = offscreenOf(self);
          Reflect.set(canvas, String(item.name), Number(args[0]) || 0);
          return undefined;
        }
        throw new TypeError(`dom Driver op invalid:${String(item.op)}`);
      },
      construct: (raw, args) => {
        const item = config(raw);
        if (item.op === 'worker') {
          if (typeof eventTarget !== 'function') {
            throw port.error('TypeError', 'EventTarget is unavailable');
          }
          if (args.length < 1) {
            throw port.error('TypeError', "Failed to construct 'Worker': 1 argument required, but only 0 present.");
          }
          const scriptUrl = String(args[0]);
          const main = Reflect.construct(eventTarget, []) as object;
          Object.setPrototypeOf(main, asObject(port, port.node('dom.Worker.proto')));
          handlers.set(main, new Map());
          const state: WorkerState = {
            terminated: false,
            main,
            scope: null,
            scriptUrl,
          };
          workers.set(main, state);
          schedule(() => {
            void resolveScript(scriptUrl)
              .then((code) => {
                if (!state.terminated) bootWorker(state, code);
              })
              .catch((error: unknown) => {
                if (!state.terminated) fireWorkerError(main, error);
              });
          });
          return main;
        }
        if (item.op === 'offscreen') {
          const canvas = makeCanvas();
          const width = Math.max(0, Math.trunc(Number(args[0]) || 0));
          const height = Math.max(0, Math.trunc(Number(args[1]) || 0));
          Reflect.set(canvas, 'width', width);
          Reflect.set(canvas, 'height', height);
          const target = Object.create(asObject(port, port.node('dom.OffscreenCanvas.proto'))) as object;
          offscreens.set(target, { canvas });
          return target;
        }
        throw new TypeError(`dom Driver construct invalid:${String(item.op)}`);
      },
    };
  },
};
