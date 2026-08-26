import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RuntimeApplication } from '../app/runtime.js';
import type { CaptureOptions, RuntimeOptions } from '../app/types.js';
import { JsdomEngine } from '../engine/jsdom.js';
import type { Engine } from '../engine/types.js';
import { drivers, features } from '../features/index.js';
import { DEFAULT_PROBE_PATH } from './assets.js';

export interface NodeRuntimeOptions {
  probePath?: string;
  engine?: Engine;
  capture?: CaptureOptions;
}

export function nodeRuntimeHost(options: NodeRuntimeOptions = {}): RuntimeOptions {
  const probePath = path.resolve(options.probePath ?? DEFAULT_PROBE_PATH);
  return {
    engine: options.engine ?? new JsdomEngine(),
    features,
    drivers,
    probe: readFileSync(probePath, 'utf8'),
    ...(options.capture === undefined ? {} : { capture: options.capture }),
  };
}

/** Execute-only host. Workers receive a Plan from the parent planner and must not load Profiles. */
export function createNodeRuntime(options: NodeRuntimeOptions = {}): RuntimeApplication {
  return new RuntimeApplication(nodeRuntimeHost(options));
}
