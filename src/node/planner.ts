import path from 'node:path';
import { Planner } from '../app/planner.js';
import type { ProfilesPort } from '../app/types.js';
import { jsdomManifest } from '../engine/manifest.js';
import { driverIds, features } from '../features/compile.js';
import { FpEnvProfiles } from '../profiles/fp-env.js';
import { LegacyProfiles } from '../legacy/profiles.js';
import { DEFAULT_PROFILES_ROOT, DEFAULT_SHAPES_ROOT } from './assets.js';

export interface NodePlannerOptions {
  profilesRoot?: string;
  shapesRoot?: string;
  profiles?: ProfilesPort;
}

export function nodeProfiles(options: NodePlannerOptions = {}): ProfilesPort {
  if (options.profiles) return options.profiles;
  const profilesRoot = path.resolve(options.profilesRoot ?? DEFAULT_PROFILES_ROOT);
  const shapesRoot = path.resolve(options.shapesRoot ?? DEFAULT_SHAPES_ROOT);
  return new FpEnvProfiles(profilesRoot, new LegacyProfiles(profilesRoot, shapesRoot));
}

export function createNodePlanner(options: NodePlannerOptions = {}): Planner {
  return new Planner({
    profiles: nodeProfiles(options),
    features,
    drivers: driverIds,
    engine: jsdomManifest(),
  });
}
