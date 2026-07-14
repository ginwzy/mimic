import { MimicError } from '../core/error.js';
import { jsonCopy } from '../core/json.js';
import { parseShape } from '../core/parse.js';
import { digest, seal } from '../core/seal.js';
import type { Data, Hash, JsonValue, Target } from '../core/types.js';
import { shape as builtShape } from '../features/index.js';
import {
  importLegacyData,
  legacyTarget,
  type ImportedProfile,
  type MigrationReport,
} from '../legacy/profiles.js';
import type { CollectBundle, RawEvidence } from './types.js';
import { probeShape } from './shape.js';
import type { ProbeSnapshot } from '../probe/diff.js';

export interface NormalizedCollect {
  readonly capture: Readonly<{ id: string; hash: Hash }>;
  readonly profile: ImportedProfile['profile'];
  readonly page?: ImportedProfile['page'];
  readonly shape: ImportedProfile['shape'];
  readonly report: MigrationReport;
}

function bad(message: string): never {
  throw new MimicError({ phase: 'parse', code: 'BAD_COLLECT', message });
}

function record(value: JsonValue | undefined): Data | undefined {
  return value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object'
    ? value
    : undefined;
}

function profileName(target: Target, identity: Hash): string {
  const mobile = target.form === 'mobile' && target.host !== 'webview' ? 'mobile' : undefined;
  return [target.platform, target.host, mobile, `v${target.version}`, identity.slice(0, 12)]
    .filter((part): part is string => part !== undefined)
    .join('-');
}

function validatePair(profileRaw: RawEvidence, probeSnapshot: RawEvidence, target: Target): void {
  const navigator = record(profileRaw.navigator);
  const profileUa = navigator?.userAgent;
  const probeMeta = record(probeSnapshot.meta);
  const probeUa = probeMeta?.ua;
  if (typeof profileUa !== 'string' || !profileUa) bad('Collect identity 缺少 navigator.userAgent');
  if (probeMeta?.complete !== true || probeMeta.probeVersion !== 1) {
    bad('Collect probe 必须是完整的 probeVersion=1 快照');
  }
  if (typeof probeUa !== 'string' || probeUa !== profileUa) bad('Collect identity 与 probe UA 不属于同一会话');

  const targets = probeSnapshot.targets;
  if (!Array.isArray(targets)) bad('Collect probe 缺少 targets');
  const chrome = targets.find((value) => {
    const item = record(value);
    return item?.id === 'window.chrome';
  });
  const chromeRecord = record(chrome);
  if (!chromeRecord || typeof chromeRecord.resolved !== 'boolean') bad('Collect probe 缺少 window.chrome 结构证据');
  if (chromeRecord.resolved !== (target.host === 'chrome')) bad('Collect identity 与 probe host 证据冲突');
}

export function normalizeCollect(bundle: CollectBundle): NormalizedCollect {
  if (bundle.profileRaw === null || bundle.probeSnapshot === null) {
    bad('部分 Collect 只能保存 raw evidence，不能派生 Profile/Shape');
  }
  const profileRaw = jsonCopy(bundle.profileRaw);
  const probeSnapshot = jsonCopy(bundle.probeSnapshot);
  const target = legacyTarget(profileRaw);
  validatePair(profileRaw, probeSnapshot, target);

  const identityHash = digest(profileRaw);
  const probeHash = digest(probeSnapshot);
  const id = profileName(target, identityHash);
  const meta = record(profileRaw.meta) || {};
  const legacy = { ...profileRaw, meta: { ...meta, name: id } };
  const source = { kind: 'capture' as const, hash: identityHash };
  const shape = probeShape(builtShape(parseShape(seal({
    schema: 2 as const,
    id: `chromium/${target.host}/${target.platform}/${target.form}/${target.version}`,
    target,
    level: 'derived' as const,
    source: { kind: 'capture' as const, hash: probeHash },
    features: [],
    ops: [],
    support: { structure: 'derived' as const },
  }))), probeSnapshot as ProbeSnapshot);
  const imported = importLegacyData(id, legacy, { source, shape });
  return {
    capture: { id: bundle.id, hash: bundle.hash },
    profile: imported.profile,
    ...(imported.page === undefined ? {} : { page: imported.page }),
    shape: imported.shape,
    report: imported.report,
  };
}
