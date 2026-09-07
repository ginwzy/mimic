import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TaskRunner } from '../runtime/runner.js';
import type { CaptureOptions, RuntimeOptions } from '../app/types.js';
import { JsdomEngine } from '../engine/jsdom.js';
import type { Engine } from '../engine/types.js';
import { drivers } from '../features/drivers.js';
import { DEFAULT_PROBE_PATH } from './assets.js';
import type { NetworkTransport } from '../network/types.js';
import { createNetDriver } from '../features/net.driver.js';

export interface NodeRuntimeOptions {
  probePath?: string;
  engine?: Engine;
  capture?: CaptureOptions;
  network?: NetworkTransport;
}

export function nodeRuntimeHost(options: NodeRuntimeOptions = {}): RuntimeOptions {
  if (options.network && options.engine) throw new TypeError('Capture network requires the managed jsdom Engine');
  const probePath = path.resolve(options.probePath ?? DEFAULT_PROBE_PATH);
  return {
    engine: options.engine ?? new JsdomEngine(options.network ? { network: options.network } : {}),
    drivers: options.network ? { ...drivers, net: createNetDriver(true) } : drivers,
    probe: readFileSync(probePath, 'utf8'),
    ...(options.capture === undefined ? {} : { capture: options.capture }),
  };
}

/** Execute-only host. Workers receive a Plan from the parent planner and must not load Profiles. */
export function createNodeRuntime(options: NodeRuntimeOptions = {}): TaskRunner {
  return new TaskRunner(nodeRuntimeHost(options));
}
