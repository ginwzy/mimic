import { describeCoverage } from './capabilities.js';
import type { DraftOp, Feature } from '../shape/types.js';
import { fnShape, refProp } from './ops.js';
import { EVAL, FUNCTION, type TraceConfig } from './trace.shared.js';

function operations(): DraftOp[] {
  return [
    {
      op: 'alloc', id: 'trace.eval', kind: 'function', slot: 'trace.eval',
      shape: fnShape('eval', 1),
    },
    {
      op: 'alloc', id: 'trace.Function', kind: 'function', slot: 'trace.Function',
      prototype: { path: 'window.Function.prototype' },
      shape: fnShape('Function', 1, true, true),
    },
    refProp({ path: 'window' }, 'eval', 'trace.eval'),
    refProp({ path: 'window' }, 'Function', 'trace.Function'),
    refProp({ path: 'window.Function.prototype' }, 'constructor', 'trace.Function'),
  ];
}

export const traceFeature: Feature = {
  id: 'trace',
  describe: (_context, support) => describeCoverage(support, {
    'trace.feature': 'structure',
    'trace.capture': 'partial',
  }),
  rev: '1',
  build: ({ job }) => {
    if (!('trace' in job) || job.trace !== true) {
      return { support: { 'trace.capture': 'unsupported' } };
    }
    return {
      operations: operations(),
      binds: [
        { slot: 'trace.eval', driver: 'trace', config: { op: 'eval' }, sources: [EVAL] },
        { slot: 'trace.Function', driver: 'trace', config: { op: 'Function' }, sources: [FUNCTION] },
      ] satisfies { slot: string; driver: string; config: TraceConfig; sources: string[] }[],
      support: { 'trace.capture': 'emulated' },
    };
  },
};
