import { describeCoverage } from './capabilities.js';
import type { Shape } from '../core/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { accessor, fn, fnShape, refProp, tag, valueProp } from './ops.js';
import { hasTouchSurface } from './touch.shared.js';

const TOUCH = ['ontouchstart', 'ontouchend', 'ontouchmove', 'ontouchcancel'] as const;

// Android Chrome omits chrome.app; retain other platforms' surfaces.
function hasApp(shape: Shape): boolean {
  return shape.target.platform !== 'android';
}

function chromeOps(shape: Shape): DraftOp[] {
  const chrome = { node: 'chrome.instance' } as const;
  const app = { node: 'chrome.app' } as const;
  const includeApp = hasApp(shape);
  return [
    { op: 'alloc', id: 'chrome.instance', kind: 'object' },
    ...(includeApp ? [{ op: 'alloc', id: 'chrome.app', kind: 'object' } satisfies DraftOp] : []),
    { op: 'alloc', id: 'chrome.load', kind: 'function', slot: 'chrome.load', shape: fnShape('', 0, true, true) },
    { op: 'alloc', id: 'chrome.csi', kind: 'function', slot: 'chrome.csi', shape: fnShape('', 0, true, true) },
    ...(includeApp ? [
      fn('chrome.details', 'chrome.details', 'getDetails'),
      fn('chrome.installed', 'chrome.installed', 'getIsInstalled'),
      fn('chrome.install-state', 'chrome.install-state', 'installState'),
      fn('chrome.running-state', 'chrome.running-state', 'runningState'),
    ] : []),
    refProp(chrome, 'loadTimes', 'chrome.load', true),
    refProp(chrome, 'csi', 'chrome.csi', true),
    ...(includeApp ? [
      refProp(chrome, 'app', 'chrome.app', true),
      valueProp(app, 'isInstalled', false, true, true),
      valueProp(app, 'InstallState', { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, true, true),
      valueProp(app, 'RunningState', { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }, true, true),
      refProp(app, 'getDetails', 'chrome.details', true),
      refProp(app, 'getIsInstalled', 'chrome.installed', true),
      refProp(app, 'installState', 'chrome.install-state', true),
      refProp(app, 'runningState', 'chrome.running-state', true),
    ] : []),
    refProp({ path: 'window' }, 'chrome', 'chrome.instance', true),
    { op: 'order', target: chrome, keys: includeApp ? ['loadTimes', 'csi', 'app'] : ['loadTimes', 'csi'] },
    ...(includeApp ? [{
      op: 'order', target: app,
      keys: ['isInstalled', 'InstallState', 'RunningState', 'getDetails', 'getIsInstalled', 'installState', 'runningState'],
    } satisfies DraftOp] : []),
  ];
}

function touchOps(shape: Shape): DraftOp[] {
  if (shape.target.form === 'mobile') {
    return [valueProp({ path: 'window' }, 'orientation', 0, true, true)];
  }
  return [
    { op: 'drop', target: { path: 'window' }, key: 'orientation' },
    ...(hasTouchSurface(shape.target) ? [] : ['window.Document.prototype', 'window.HTMLElement.prototype'].flatMap((path) =>
      TOUCH.map((key): DraftOp => ({ op: 'drop', target: { path }, key })))),
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
    // Disk shapes skip chromeShape; re-assert non-isolated SAB absence (PL710/MU).
    { op: 'drop', target: { path: 'window' }, key: 'SharedArrayBuffer' },
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

export function operations(shape: Shape): DraftOp[] {
  const chrome = shape.target.host === 'chrome';
  return [
    ...(chrome ? chromeOps(shape) : [{ op: 'drop', target: { path: 'window' }, key: 'chrome' } as DraftOp]),
    ...touchOps(shape),
    ...securityOps(),
    ...(chrome ? mediaSurfaceOps() : []),
  ];
}

/** True when Shape already props a key (e.g. dom.missing already stubbed Document.hasPrivateToken). */
function shapeHasProp(shape: Shape, path: string, key: string): boolean {
  for (const raw of shape.ops) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const op = raw as DraftOp;
    if (op.op !== 'prop') continue;
    const target = op.target;
    if (!target || typeof target !== 'object' || !('path' in target) || target.path !== path) continue;
    if (op.key === key) return true;
  }
  return false;
}

/**
 * Disk shapes may already install Document privacy-token stubs via dom.missing.
 * Skip those props to avoid WRITE_CONFLICT; still install PushManager / iframe.loading / SAB drop.
 */
function bmsCapabilityOpsFor(shape: Shape): DraftOp[] {
  const doc = 'window.Document.prototype';
  const skipDoc = new Set(
    (['hasPrivateToken', 'hasRedemptionRecord'] as const).filter((key) => shapeHasProp(shape, doc, key)),
  );
  if (skipDoc.size === 0) return bmsCapabilityOps();
  return bmsCapabilityOps().filter((op) => {
    if (op.op !== 'prop') return true;
    const target = op.target;
    if (!target || typeof target !== 'object' || !('path' in target) || target.path !== doc) return true;
    return typeof op.key !== 'string' || !skipDoc.has(op.key as 'hasPrivateToken' | 'hasRedemptionRecord');
  });
}

export const chromeFeature: Feature = {
  id: 'chrome',
  jobKeys: [],
  describe: (_context, support) => describeCoverage(support, {
    'chrome.api': 'partial',
    'chrome.bms-capability': 'partial',
    'chrome.media-surface': 'structure',
  }),
  rev: '4',
  requires: ['screen'],
  build: ({ shape }) => ({
    // Only chrome host; webview keeps lean surface.
    operations: shape.target.host === 'chrome' ? [
      ...bmsCapabilityOpsFor(shape),
      fn('chrome.Notification.requestPermission', 'chrome.Notification.requestPermission', 'requestPermission'),
      refProp({ node: 'chrome.Notification.ctor' }, 'requestPermission', 'chrome.Notification.requestPermission', true),
      fn('chrome.Notification.maxActions.get', 'chrome.Notification.maxActions', 'get maxActions'),
      accessor({ node: 'chrome.Notification.ctor' }, 'maxActions', 'chrome.Notification.maxActions.get'),
    ] : [],
    binds: [
      { slot: 'chrome.load', driver: 'chrome', config: { op: 'load' } },
      { slot: 'chrome.csi', driver: 'chrome', config: { op: 'csi' } },
      ...(hasApp(shape) ? [
        { slot: 'chrome.details', driver: 'chrome', config: { op: 'value', value: null } },
        { slot: 'chrome.installed', driver: 'chrome', config: { op: 'value', value: false } },
        { slot: 'chrome.install-state', driver: 'chrome', config: { op: 'value', value: 'disabled' } },
        { slot: 'chrome.running-state', driver: 'chrome', config: { op: 'value', value: 'cannot_run' } },
      ] : []),
      { slot: 'chrome.speech.getVoices', driver: 'chrome', config: { op: 'value', value: [] } },
      ...(shape.target.host === 'chrome'
        ? [
            { slot: 'chrome.Notification.requestPermission', driver: 'chrome', config: { op: 'permission' as const } },
            { slot: 'chrome.Notification.maxActions', driver: 'chrome', config: { op: 'value' as const, value: 2 } },
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
