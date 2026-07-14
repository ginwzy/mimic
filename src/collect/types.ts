import type { Hash, JsonValue } from '../core/types.js';

export type RawEvidence = Record<string, JsonValue>;

export interface CollectBundle {
  readonly schema: 2;
  readonly id: string;
  readonly hash: Hash;
  readonly profileRaw: RawEvidence | null;
  readonly probeSnapshot: RawEvidence | null;
}

export interface LegacyCollectV1 {
  readonly profileRaw: RawEvidence | null;
  readonly probeSnapshot: RawEvidence | null;
}
