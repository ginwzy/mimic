import type { Data, Hash, Page, Part, Profile, Shape, Source, Target } from '../core/types.js';

export interface IdentityFacts {
  navigator: Data;
  screen: Data;
  window?: Data;
  timezone?: Data;
  webgl?: Data;
  audio?: Data;
  systemColors?: Data;
  canvas?: Data;
}

export interface PageFacts {
  url?: string;
  connection?: Data;
  clock?: Data;
}

export interface NormalizationInput {
  id: string;
  target: Target;
  shape: Shape;
  source: Source;
  identity: IdentityFacts;
  page?: PageFacts;
  captured: readonly Part[];
  derived?: readonly string[];
}

export interface NormalizedIdentity {
  profile: Profile;
  page?: Page;
  shape: Shape;
  derived: string[];
}

export interface LedgerEntry {
  status: 'mapped' | 'consumed' | 'raw-preserved';
  target?: string;
  source?: { id: string; hash: Hash };
}

export interface NormalizationReport {
  id: string;
  chain: string[];
  meta: Data;
  ledger: Record<string, LedgerEntry>;
  warnings: string[];
  derived: string[];
}

export interface ImportedProfile {
  profile: Profile;
  page?: Page;
  shape: Shape;
  report: NormalizationReport;
}
