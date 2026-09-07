import { MimicError } from '../core/error.js';
import { jsonCopy } from '../core/json.js';
import { digest } from '../core/seal.js';
import type { Shape, Source, Target } from '../core/types.js';
import { browserFacts, capturedParts, isData, type BrowserEvidence } from '../profiles/browser.js';
import { normalizeIdentity as normalizeFacts } from '../profiles/normalize.js';
import { createReport } from '../profiles/report.js';
import { inferTarget, validateTargetClaims } from '../profiles/target.js';
import type { ImportedProfile } from '../profiles/types.js';

export { shapeForTarget as targetShape } from '../profiles/shapes.js';
export type { ImportedProfile, LedgerEntry, NormalizationReport as MigrationReport } from '../profiles/types.js';

function identityData(input: unknown): BrowserEvidence {
  let value;
  try {
    value = jsonCopy(input);
  } catch (cause) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: 'Identity 不是纯 JSON', cause });
  }
  if (!isData(value)) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: 'Identity 不是对象' });
  }
  return value;
}

function deriveTarget(data: BrowserEvidence): Target {
  const target = inferTarget(data);
  validateTargetClaims(target, data.meta?.traits);
  return target;
}

export function identityTarget(input: unknown): Target {
  return deriveTarget(identityData(input));
}

export function normalizeIdentity(
  id: string,
  input: unknown,
  options: { source?: Source; shape: Shape; derived?: readonly string[] },
): ImportedProfile {
  const data = identityData(input);
  if (!isData(data.navigator) || !isData(data.screen)) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `Identity 缺少 navigator 或 screen:${id}` });
  }
  const name = data.meta?.name;
  if (name !== id) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `Identity 名称 ${String(name)} 与 id ${id} 不符` });
  }
  const target = deriveTarget(data);
  const source = options.source ?? { kind: 'manual' as const, hash: digest(data) };
  const { derived, ...normalized } = normalizeFacts({
    id, target, shape: options.shape, source, ...browserFacts(data),
    captured: capturedParts(data.meta?.fidelity),
    ...(options.derived === undefined ? {} : { derived: options.derived }),
  });
  return { ...normalized, report: createReport(id, data, derived) };
}
