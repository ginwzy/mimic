import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { deepFreeze } from '../core/json.js';
import type { EngineManifest } from '../shape/types.js';

export const JSDOM_ENGINE_ABI = 'mimic-jsdom-v2.12';
export const REQUESTED_JSDOM_VERSION = '29.1.1';

/** Planning needs engine identity, not a live engine or its installation hooks. */
export function jsdomManifest(): EngineManifest {
  const require = createRequire(import.meta.url);
  const jsdomVersion = (require('jsdom/package.json') as { version: string }).version;
  const source = {
    engine: 'jsdom',
    abi: JSDOM_ENGINE_ABI,
    jsdom: jsdomVersion,
    requestedJsdom: REQUESTED_JSDOM_VERSION,
    node: process.versions.node.split('.')[0],
    v8: process.versions.v8,
    options: { runScripts: 'outside-only', pretendToBeVisual: true, cookieJar: true },
  };
  return deepFreeze({
    id: 'jsdom',
    hash: createHash('sha256').update(JSON.stringify(source)).digest('hex'),
    blocked: [],
  });
}
