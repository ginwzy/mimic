import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Application, type ApplicationOptions, type CaptureOptions, type ProfilesPort } from '../app/index.js';
import { MimicError } from '../core/error.js';
import { JsdomEngine } from '../engine/jsdom.js';
import type { Engine } from '../engine/types.js';
import { drivers, features } from '../features/index.js';
import { DEFAULT_PROBE_PATH } from './assets.js';

export interface NodeRuntimeOptions {
  probePath?: string;
  engine?: Engine;
  capture?: CaptureOptions;
}

const RUNTIME_PROFILES: ProfilesPort = {
  async load(id) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `runtime Application 不能加载 Profile:${id}` });
  },
  async list() {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: 'runtime Application 不能列出 Profile' });
  },
};

export function nodeRuntimeHost(options: NodeRuntimeOptions = {}): Omit<ApplicationOptions, 'profiles'> {
  const probePath = path.resolve(options.probePath ?? DEFAULT_PROBE_PATH);
  return {
    engine: options.engine ?? new JsdomEngine(),
    features,
    drivers,
    probe: readFileSync(probePath, 'utf8'),
    ...(options.capture === undefined ? {} : { capture: options.capture }),
  };
}

/** Execute-only Application. Workers receive a Plan from the parent planner and must not load Profiles. */
export function createNodeRuntime(options: NodeRuntimeOptions = {}): Application {
  return new Application({ profiles: RUNTIME_PROFILES, ...nodeRuntimeHost(options) });
}
