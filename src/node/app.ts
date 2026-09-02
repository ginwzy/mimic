import path from 'node:path';
import { Application } from '../app/index.js';
import type { CaptureOptions, ProfilesPort } from '../app/types.js';
import type { Engine } from '../engine/types.js';
import { FpEnvProfiles } from '../legacy/fp-env.js';
import { LegacyProfiles } from '../legacy/profiles.js';
import { DEFAULT_PROFILES_ROOT, DEFAULT_SHAPES_ROOT } from './assets.js';
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
  const shapesRoot = path.resolve(options.shapesRoot ?? DEFAULT_SHAPES_ROOT);
  return new Application({
    profiles: options.profiles ?? new FpEnvProfiles(
      profilesRoot,
      new LegacyProfiles(profilesRoot, shapesRoot),
    ),
    ...nodeRuntimeHost(options),
  });
}
