import type { Job, Page, Profile, Shape, SupportMap } from '../core/types.js';
import type { Drivers, Engine } from '../engine/types.js';
import type { Feature } from '../shape/types.js';

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
  features: readonly Feature[];
  drivers: Drivers;
  probe: string;
  capture?: CaptureOptions;
}

export interface ApplicationOptions extends RuntimeOptions {
  profiles: ProfilesPort;
}
