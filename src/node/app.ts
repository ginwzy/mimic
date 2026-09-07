import path from 'node:path';
import { Application } from '../app/index.js';
import type { CaptureOptions, ProfilesPort } from '../app/types.js';
import type { Engine } from '../engine/types.js';
import { FpEnvProfiles } from './fp-env.js';
import { DEFAULT_PROFILES_ROOT } from './assets.js';
import { nodeRuntimeHost } from './runtime.js';

export interface NodeApplicationOptions {
  profilesRoot?: string;
  shapesRoot?: string;
  probePath?: string;
  profiles?: ProfilesPort;
  engine?: Engine;
  capture?: CaptureOptions;
}

export function createNodeApplication(options: NodeApplicationOptions = {}): Application {
  const profilesRoot = path.resolve(options.profilesRoot ?? DEFAULT_PROFILES_ROOT);
  return new Application({
    profiles: options.profiles ?? new FpEnvProfiles(profilesRoot),
    ...nodeRuntimeHost(options),
  });
}
