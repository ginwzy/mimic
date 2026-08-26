import type { CollectBundle, Data } from '../core/types.js';

export type { CollectBundle };
export type RawEvidence = Data;

export interface LegacyCollectV1 {
  readonly profileRaw: RawEvidence | null;
  readonly probeSnapshot: RawEvidence | null;
}
