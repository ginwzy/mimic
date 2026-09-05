import type { Shape } from '../core/types.js';
import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { DraftOp } from '../shape/types.js';
import { operations } from './chrome.compile.js';
import { appendShape, extendShape, shapeSupport } from './extend.js';

const DOCUMENT_PROTOTYPE = 'window.Document.prototype';
const PRIVATE_TOKEN_KEYS = ['hasPrivateToken', 'hasRedemptionRecord'] as const;

// Derived Android Shapes need the same Document key order as the captured BMS capability stubs.
export function finalizeChromeShape(input: Shape): Shape {
  if (input.target.host !== 'chrome') return input;
  let changed = false;
  const ops = input.ops.map((raw) => {
    if (raw === null || Array.isArray(raw) || typeof raw !== 'object') return raw;
    const op = raw as DraftOp;
    if (op.op !== 'order' || !('path' in op.target) || op.target.path !== DOCUMENT_PROTOTYPE) return raw;
    const missing = PRIVATE_TOKEN_KEYS.filter((key) => !op.keys.includes(key));
    if (missing.length === 0) return raw;
    const keys = [...op.keys];
    const insertionIndex = keys.indexOf('fragmentDirective') + 1;
    keys.splice(insertionIndex, 0, ...missing);
    changed = true;
    return { ...op, keys } satisfies DraftOp;
  });
  if (!changed) return input;
  const { hash: _hash, ...body } = input;
  return parseShape(seal({ ...body, ops }));
}

export function chromeShape(shape: Shape): Shape {
  const chrome = shape.target.host === 'chrome';
  if (!chrome && shape.support['chrome.shape'] !== undefined) return shape;
  return chrome
    ? extendShape(shape, 'chrome', operations(shape), { 'chrome.shape': shapeSupport(shape) })
    : appendShape(shape, operations(shape), { 'chrome.shape': shapeSupport(shape) });
}

/** Retain support insertion order after Touch without recursing through its builder. */
export function chromeSupport(shape: Shape): Shape {
  return appendShape(shape, [], {
    'window.secure-context': 'emulated',
    ...(shape.target.host === 'chrome' ? { 'chrome.media-surface': 'emulated' as const } : {}),
  });
}
