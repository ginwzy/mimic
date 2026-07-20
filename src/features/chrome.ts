import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Shape } from '../core/types.js';
import type { Driver } from '../engine/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, fn, fnShape, refProp, tag, valueProp } from './ops.js';
import { screenShape } from './screen.js';

const TOUCH = ['ontouchstart', 'ontouchend', 'ontouchmove', 'ontouchcancel'] as const;

function chromeOps(): DraftOp[] {
  const chrome = { node: 'chrome.instance' } as const;
  const app = { node: 'chrome.app' } as const;
  return [
    { op: 'alloc', id: 'chrome.instance', kind: 'object' },
    { op: 'alloc', id: 'chrome.app', kind: 'object' },
    { op: 'alloc', id: 'chrome.load', kind: 'function', slot: 'chrome.load', shape: fnShape('', 0, true, true) },
    { op: 'alloc', id: 'chrome.csi', kind: 'function', slot: 'chrome.csi', shape: fnShape('', 0, true, true) },
    fn('chrome.details', 'chrome.details', 'getDetails'),
    fn('chrome.installed', 'chrome.installed', 'getIsInstalled'),
    fn('chrome.install-state', 'chrome.install-state', 'installState'),
    fn('chrome.running-state', 'chrome.running-state', 'runningState'),
    refProp(chrome, 'loadTimes', 'chrome.load', true),
    refProp(chrome, 'csi', 'chrome.csi', true),
    refProp(chrome, 'app', 'chrome.app', true),
    valueProp(app, 'isInstalled', false, true, true),
    valueProp(app, 'InstallState', { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, true, true),
    valueProp(app, 'RunningState', { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }, true, true),
    refProp(app, 'getDetails', 'chrome.details', true),
    refProp(app, 'getIsInstalled', 'chrome.installed', true),
    refProp(app, 'installState', 'chrome.install-state', true),
    refProp(app, 'runningState', 'chrome.running-state', true),
    refProp({ path: 'window' }, 'chrome', 'chrome.instance', true),
    { op: 'order', target: chrome, keys: ['loadTimes', 'csi', 'app'] },
    {
      op: 'order', target: app,
      keys: ['isInstalled', 'InstallState', 'RunningState', 'getDetails', 'getIsInstalled', 'installState', 'runningState'],
    },
  ];
}

function touchOps(shape: Shape): DraftOp[] {
  if (shape.target.form === 'mobile') {
    return [valueProp({ path: 'window' }, 'orientation', 0, true, true)];
  }
  return [
    { op: 'drop', target: { path: 'window' }, key: 'orientation' },
    ...['window.Document.prototype', 'window.HTMLElement.prototype'].flatMap((path) =>
      TOUCH.map((key): DraftOp => ({ op: 'drop', target: { path }, key }))),
  ];
}

/** jsdom omits Window.isSecureContext / crossOriginIsolated; Chrome exposes both. */
function securityOps(): DraftOp[] {
  return [
    valueProp({ path: 'window' }, 'isSecureContext', true, true, true),
    valueProp({ path: 'window' }, 'crossOriginIsolated', false, true, true),
  ];
}

/**
 * Minimal Notification + speechSynthesis so typeof/in probes match Chrome Android.
 * BMS capability vectors flip false when these are missing (not full Web Speech/Notification).
 */
function mediaSurfaceOps(): DraftOp[] {
  const notifProto = { node: 'chrome.Notification.proto' } as const;
  const speechProto = { node: 'chrome.speech.proto' } as const;
  const speechInst = { node: 'chrome.speech.instance' } as const;
  return [
    { op: 'alloc', id: 'chrome.Notification.proto', kind: 'object' },
    {
      op: 'alloc', id: 'chrome.Notification.ctor', kind: 'function',
      shape: fnShape('Notification', 1, true, true), prototype: notifProto,
    },
    { op: 'proto', target: notifProto, value: { path: 'window.EventTarget.prototype' } },
    refProp({ path: 'window' }, 'Notification', 'chrome.Notification.ctor'),
    refProp(notifProto, 'constructor', 'chrome.Notification.ctor'),
    valueProp(notifProto, 'permission', 'default', true, true),
    valueProp({ node: 'chrome.Notification.ctor' }, 'permission', 'default', true, true),
    tag(notifProto, 'Notification'),

    { op: 'alloc', id: 'chrome.speech.proto', kind: 'object' },
    { op: 'alloc', id: 'chrome.speech.instance', kind: 'object' },
    { op: 'proto', target: speechProto, value: { path: 'window.EventTarget.prototype' } },
    { op: 'proto', target: speechInst, value: speechProto },
    refProp({ path: 'window' }, 'speechSynthesis', 'chrome.speech.instance', true),
    fn('chrome.speech.getVoices', 'chrome.speech.getVoices', 'getVoices', 0),
    refProp(speechProto, 'getVoices', 'chrome.speech.getVoices', true),
    tag(speechProto, 'SpeechSynthesis'),
  ];
}

/**
 * BMS HD (PL248) capability surface via chromeFeature.operations.
 * Document order keys for hasPrivateToken are patched on chromium/chrome shapes (see generate:shapes
 * post-step / docs); props install here so stage order (prop before order) matches.
 */
function bmsCapabilityOps(): DraftOp[] {
  const pushProto = { node: 'chrome.PushManager.proto' } as const;
  const iframeProto = { path: 'window.HTMLIFrameElement.prototype' } as const;
  const docProto = { path: 'window.Document.prototype' } as const;
  return [
    { op: 'alloc', id: 'chrome.PushManager.proto', kind: 'object' },
    {
      op: 'alloc', id: 'chrome.PushManager.ctor', kind: 'function',
      shape: fnShape('PushManager', 0, true, true), prototype: pushProto,
    },
    refProp({ path: 'window' }, 'PushManager', 'chrome.PushManager.ctor'),
    refProp(pushProto, 'constructor', 'chrome.PushManager.ctor'),
    tag(pushProto, 'PushManager'),

    fn('chrome.hasPrivateToken', 'chrome.hasPrivateToken', 'hasPrivateToken', 1),
    refProp(docProto, 'hasPrivateToken', 'chrome.hasPrivateToken', true),
    fn('chrome.hasRedemptionRecord', 'chrome.hasRedemptionRecord', 'hasRedemptionRecord', 1),
    refProp(docProto, 'hasRedemptionRecord', 'chrome.hasRedemptionRecord', true),

    fn('chrome.iframe.loading.get', 'chrome.iframe.loading.get', 'get loading'),
    fn('chrome.iframe.loading.set', 'chrome.iframe.loading.set', 'set loading', 1),
    accessor(iframeProto, 'loading', 'chrome.iframe.loading.get', 'chrome.iframe.loading.set'),
  ];
}

export function chromeTouchShape(input: Shape): Shape {
  const shape = screenShape(input);
  if (shape.features.includes('touch')) return shape;
  const chrome = shape.target.host === 'chrome';
  const { hash: _hash, ...body } = shape;
  return parseShape(seal({
    ...body,
    features: [...shape.features, 'touch', ...(chrome ? ['chrome'] : [])].sort(),
    ops: [
      ...shape.ops,
      ...(chrome ? chromeOps() : [{ op: 'drop', target: { path: 'window' }, key: 'chrome' } as DraftOp]),
      ...touchOps(shape),
      ...securityOps(),
      ...(chrome ? mediaSurfaceOps() : []),
    ],
    support: {
      ...shape.support,
      'chrome.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'touch.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'window.secure-context': 'emulated',
      ...(chrome ? { 'chrome.media-surface': 'emulated' as const } : {}),
    },
  }));
}

export const chromeFeature: Feature = {
  id: 'chrome',
  rev: '2',
  requires: ['screen'],
  build: ({ shape }) => ({
    // Only chrome host; webview keeps lean surface.
    operations: shape.target.host === 'chrome' ? bmsCapabilityOps() : [],
    binds: [
      { slot: 'chrome.load', driver: 'chrome', config: { op: 'load' } },
      { slot: 'chrome.csi', driver: 'chrome', config: { op: 'csi' } },
      { slot: 'chrome.details', driver: 'chrome', config: { op: 'value', value: null } },
      { slot: 'chrome.installed', driver: 'chrome', config: { op: 'value', value: false } },
      { slot: 'chrome.install-state', driver: 'chrome', config: { op: 'value', value: 'disabled' } },
      { slot: 'chrome.running-state', driver: 'chrome', config: { op: 'value', value: 'cannot_run' } },
      { slot: 'chrome.speech.getVoices', driver: 'chrome', config: { op: 'value', value: [] } },
      ...(shape.target.host === 'chrome'
        ? [
            { slot: 'chrome.hasPrivateToken', driver: 'chrome', config: { op: 'token-false' as const } },
            { slot: 'chrome.hasRedemptionRecord', driver: 'chrome', config: { op: 'token-false' as const } },
            { slot: 'chrome.iframe.loading.get', driver: 'chrome', config: { op: 'iframe-loading-get' as const } },
            { slot: 'chrome.iframe.loading.set', driver: 'chrome', config: { op: 'iframe-loading-set' as const } },
          ]
        : []),
    ],
    support: {
      'chrome.api': 'emulated',
      ...(shape.target.host === 'chrome' ? { 'chrome.bms-capability': 'emulated' as const } : {}),
    },
  }),
};

export const touchFeature: Feature = {
  id: 'touch',
  rev: '1',
  requires: ['screen'],
  build: () => ({ support: { 'touch.api': 'shape-only' } }),
};

function config(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError('chrome Driver config invalid');
  return value;
}

export const chromeDriver: Driver = {
  open: (port) => {
    // Per-iframe loading attribute; Chrome defaults to "auto".
    const loading = new WeakMap<object, string>();
    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'load') {
          const time = port.origin() / 1000;
          return port.clone({
            requestTime: time, startLoadTime: time, commitLoadTime: time + 0.04,
            finishDocumentLoadTime: 0, finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0,
            navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true,
            npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2',
          });
        }
        if (item.op === 'csi') {
          const time = Math.floor(port.origin());
          return port.clone({ startE: time, onloadT: time + 300, pageT: 1200.5, tran: 15 });
        }
        if (item.op === 'value') {
          return item.value !== null && typeof item.value === 'object' ? port.clone(item.value) : item.value;
        }
        if (item.op === 'token-false') {
          return Promise.resolve(false);
        }
        if (item.op === 'iframe-loading-get') {
          if (self !== null && typeof self === 'object') {
            return loading.get(self) ?? 'auto';
          }
          return 'auto';
        }
        if (item.op === 'iframe-loading-set') {
          if (self !== null && typeof self === 'object') {
            const next = args[0] === undefined || args[0] === null ? 'auto' : String(args[0]);
            loading.set(self, next === '' ? 'auto' : next);
          }
          return undefined;
        }
        throw new TypeError(`chrome Driver op invalid:${String(item.op)}`);
      },
    };
  },
};
