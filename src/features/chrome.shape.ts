import type { Shape } from '../core/types.js';
import { parseShape } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type { DraftOp } from '../shape/types.js';
import { operations } from './chrome.js';
import { appendShape, extendShape, shapeSupport } from './extend.js';
import { screenShape } from './screen.shape.js';
import { touchShape } from './touch.shape.js';

const DOCUMENT_PROTOTYPE = 'window.Document.prototype';
const PRIVATE_TOKEN_KEYS = ['hasPrivateToken', 'hasRedemptionRecord'] as const;

// Derived Android Shapes need the same Document key order as the captured BMS capability stubs.
function chromeDocumentOrder(input: Shape): Shape {
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

export function chromeShape(input: Shape): Shape {
  let shape = screenShape(input);
  const chrome = shape.target.host === 'chrome';
  if (!chrome && shape.support['chrome.shape'] !== undefined) return touchShape(shape);
  if (chrome) shape = chromeDocumentOrder(shape);
  shape = chrome
    ? extendShape(shape, 'chrome', operations(shape), { 'chrome.shape': shapeSupport(shape) })
    : appendShape(shape, operations(shape), { 'chrome.shape': shapeSupport(shape) });
  shape = touchShape(shape);
  return appendShape(shape, [], {
    'window.secure-context': 'emulated',
    ...(chrome ? { 'chrome.media-surface': 'emulated' as const } : {}),
  });
}
