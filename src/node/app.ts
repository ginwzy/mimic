import { Application } from '../app/index.js';
import type { CaptureOptions, ProfilesPort } from '../app/types.js';
import type { Engine } from '../engine/types.js';
import { features } from '../features/compile.js';
import { nodeProfiles } from './planner.js';
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
  return new Application({
    profiles: nodeProfiles(options),
    features,
    ...nodeRuntimeHost(options),
  });
}
