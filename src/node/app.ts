import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Application, type CaptureOptions, type ProfilesPort } from '../app/index.js';
import { JsdomEngine } from '../engines/jsdom.js';
import type { Engine } from '../engine/types.js';
import { drivers, features } from '../features/index.js';
import { LegacyProfiles } from '../legacy/profiles.js';
import { DEFAULT_PROBE_PATH, DEFAULT_PROFILES_ROOT, DEFAULT_SHAPES_ROOT } from './assets.js';

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
  const probePath = path.resolve(options.probePath ?? DEFAULT_PROBE_PATH);
  return new Application({
    profiles: options.profiles ?? new LegacyProfiles(
      profilesRoot,
      shapesRoot,
    ),
    engine: options.engine ?? new JsdomEngine(),
    features,
    drivers,
    probe: readFileSync(probePath, 'utf8'),
    ...(options.capture === undefined ? {} : { capture: options.capture }),
  });
}
