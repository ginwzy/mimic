import { MimicError } from '../core/error.js';
import { jsonCopy } from '../core/json.js';
import { parseCollect } from '../core/parse.js';
import { digest, seal } from '../core/seal.js';
import type { JsonValue } from '../core/types.js';
import type { CollectBundle, LegacyCollectV1 } from './types.js';

function bad(message: string, cause?: unknown): never {
  throw new MimicError({
    phase: 'parse',
    code: 'BAD_COLLECT',
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function copy(input: unknown): JsonValue {
  try {
    return jsonCopy(input);
  } catch (cause) {
    return bad('Collect 不是纯 JSON', cause);
  }
}

function legacy(input: JsonValue): LegacyCollectV1 {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return bad('Legacy Collect 必须是对象');
  }
  const keys = Object.keys(input);
  if (keys.length !== 2 || !Object.hasOwn(input, 'profileRaw') || !Object.hasOwn(input, 'probeSnapshot')) {
    return bad('Legacy Collect 只能包含 profileRaw 与 probeSnapshot');
  }
  return input as unknown as LegacyCollectV1;
}

export function migrateCollect(input: unknown): CollectBundle {
  const clean = copy(input);
  if (clean !== null && typeof clean === 'object' && !Array.isArray(clean) && Object.hasOwn(clean, 'schema')) {
    if (clean.schema !== 2) return bad(`不支持的 Collect schema:${String(clean.schema)}`);
    return parseCollect(clean);
  }

  const source = legacy(clean);
  const evidence = {
    profileRaw: source.profileRaw,
    probeSnapshot: source.probeSnapshot,
  };
  const body = {
    schema: 2 as const,
    id: `collect:${digest(evidence)}`,
    ...evidence,
  };
  return parseCollect(seal(body));
}

export { parseCollect };
export type { CollectBundle, LegacyCollectV1, RawEvidence } from './types.js';
