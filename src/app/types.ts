import type { Job, Page, Plan, Profile, Shape, SupportMap } from '../core/types.js';
import type { Drivers, Engine } from '../engine/types.js';
import type { EngineManifest, Feature, Op, PlanBind } from '../shape/types.js';

export interface ProfileRecord {
  profile: Profile;
  page?: Page;
  shape: Shape;
}

export interface ProfilesPort {
  load(id: string): Promise<ProfileRecord>;
  list(): Promise<string[]>;
}

export interface CaptureOptions {
  deadlineMs?: number;
  pollMs?: number;
  maxPosts?: number;
  lifecycle?: CaptureLifecycle;
}

export type CaptureLifecycle = 'auto' | 'none';

export interface TaskRequest {
  profile: string;
  job: Job;
  page?: Page;
  shape?: Shape;
  require?: SupportMap;
  synthetic?: boolean;
}

export type ListKind = 'profiles' | 'shapes' | 'features' | 'drivers';

export interface RuntimeOptions {
  engine: Engine;
  drivers: Drivers;
  probe: string;
  capture?: CaptureOptions;
}

export interface ApplicationOptions extends RuntimeOptions {
  features: readonly Feature[];
  profiles: ProfilesPort;
}

export interface PlannerOptions {
  profiles: ProfilesPort;
  features: readonly Feature[];
  drivers: readonly string[];
  engine: EngineManifest;
}

export interface PlannerPort {
  plan(request: TaskRequest): Promise<Plan<Op, PlanBind>>;
  list(kind: ListKind): Promise<readonly string[]>;
}
