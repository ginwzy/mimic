import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { JsonValue, Shape } from '../core/types.js';
import type { Driver } from '../engine/types.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { fn, fnShape, refProp, valueProp } from './ops.js';
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
    ],
    support: {
      ...shape.support,
      'chrome.shape': shape.level === 'captured' ? 'captured' : 'derived',
      'touch.shape': shape.level === 'captured' ? 'captured' : 'derived',
    },
  }));
}

export const chromeFeature: Feature = {
  id: 'chrome',
  rev: '1',
  requires: ['screen'],
  build: () => ({
    binds: [
      { slot: 'chrome.load', driver: 'chrome', config: { op: 'load' } },
      { slot: 'chrome.csi', driver: 'chrome', config: { op: 'csi' } },
      { slot: 'chrome.details', driver: 'chrome', config: { op: 'value', value: null } },
      { slot: 'chrome.installed', driver: 'chrome', config: { op: 'value', value: false } },
      { slot: 'chrome.install-state', driver: 'chrome', config: { op: 'value', value: 'disabled' } },
      { slot: 'chrome.running-state', driver: 'chrome', config: { op: 'value', value: 'cannot_run' } },
    ],
    support: { 'chrome.api': 'emulated' },
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
  open: (port) => ({
    call: (raw) => {
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
      throw new TypeError(`chrome Driver op invalid:${String(item.op)}`);
    },
  }),
};
