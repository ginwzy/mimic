import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { MimicError } from '../core/error.js';
import { jsonCopy } from '../core/json.js';
import { parseShape } from '../core/parse.js';
import { digest } from '../core/seal.js';
import type { Data, Hash, JsonValue, Shape, Source, Target } from '../core/types.js';
import { browserFacts, capturedParts, isData, requireIdentity, type BrowserEvidence as Legacy } from '../profiles/browser.js';
import { normalizeIdentity } from '../profiles/normalize.js';
import { inferTarget, validateTargetClaims } from '../profiles/target.js';
import { shapeForTarget as legacyShape, compatibleShape } from '../profiles/shapes.js';
import { createReport, ledgerOf, originsOf, warningsOf } from '../profiles/report.js';
import type { ImportedProfile, NormalizationReport as MigrationReport } from '../profiles/types.js';

export { legacyShape };
export type { ImportedProfile, LedgerEntry, NormalizationReport as MigrationReport } from '../profiles/types.js';

const IDENTITY = new Set(['canvas', 'webgl', 'audio', 'fonts']);

interface Resolved {
  data: Legacy;
  chain: string[];
  hashes: Hash[];
  origins: Record<string, { id: string; hash: Hash }>;
}

interface ShapeManifest {
  schema: 1;
  files: Record<string, { file: string; sha256: string }>;
}

const clone = <T extends JsonValue>(value: T): T => structuredClone(value);

function merge(base: Data, over: Data): Data {
  const output: Data = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const previous = base[key];
    output[key] = IDENTITY.has(key) || !isData(previous) || !isData(value)
      ? clone(value)
      : merge(previous, value);
  }
  return output;
}

function deriveTarget(data: Legacy): Target {
  const target = inferTarget(data);
  validateTargetClaims(target, data.meta?.traits);
  return target;
}

function legacyData(input: unknown): Legacy {
  let value: JsonValue;
  try {
    value = jsonCopy(input);
  } catch (cause) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: '旧 Profile 不是纯 JSON', cause });
  }
  if (!isData(value)) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: '旧 Profile 不是对象' });
  }
  return value as Legacy;
}

export function legacyTarget(input: unknown): Target {
  return deriveTarget(legacyData(input));
}

function sourceOf(id: string, data: Legacy, hashes: Hash[]): Source {
  const source = data.meta?.source;
  const kind: Source['kind'] = source === 'capture'
    ? 'capture'
    : (typeof source === 'string' && source.startsWith('fp_env') ? 'fp-env' : 'manual');
  const hash = createHash('sha256').update(JSON.stringify(hashes)).digest('hex') as Hash;
  return { kind, hash, file: `profiles/${id}.json` };
}

export function importLegacyData(
  id: string,
  input: unknown,
  options: { source?: Source; shape: Shape; derived?: readonly string[] },
): ImportedProfile {
  const data = legacyData(input);
  requireIdentity(data);
  const name = data.meta?.name;
  if (name !== id) {
    throw new MimicError({ phase: 'parse', code: 'LEGACY_NAME', message: `Profile 名称 ${String(name)} 与路径 ${id} 不符` });
  }
  const target = deriveTarget(data);
  const source = options.source || sourceOf(id, data, [digest(data)]);
  const { derived, ...normalized } = normalizeIdentity({
    id, target, shape: options.shape, source, ...browserFacts(data),
    captured: capturedParts(data.meta?.fidelity),
    ...(options.derived === undefined ? {} : { derived: options.derived }),
  });
  return { ...normalized, report: createReport(id, data, derived) };
}

export class LegacyProfiles {
  readonly root: string;
  readonly shapesRoot: string | undefined;
  private manifestPromise: Promise<ShapeManifest> | undefined;
  private readonly artifactShapes = new Map<string, Promise<Shape | undefined>>();

  constructor(root: string, shapesRoot?: string) {
    this.root = path.resolve(root);
    this.shapesRoot = shapesRoot === undefined ? undefined : path.resolve(shapesRoot);
  }

  async list(): Promise<string[]> {
    const walk = async (directory: string, prefix = ''): Promise<string[]> => {
      const entries = await readdir(directory, { withFileTypes: true });
      const output: string[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith('_')) continue;
        if (entry.isDirectory()) output.push(...await walk(path.join(directory, entry.name), `${prefix}${entry.name}/`));
        else if (entry.name.endsWith('.json')) output.push(`${prefix}${entry.name.slice(0, -5)}`);
      }
      return output;
    };
    return (await walk(this.root)).sort();
  }

  private file(id: string): string {
    const file = path.resolve(this.root, `${id}.json`);
    if (!file.startsWith(`${this.root}${path.sep}`)) {
      throw new MimicError({ phase: 'parse', code: 'LEGACY_PATH', message: `Profile 路径越界:${id}` });
    }
    return file;
  }

  private async resolve(id: string, visiting = new Set<string>()): Promise<Resolved> {
    if (visiting.has(id)) {
      throw new MimicError({ phase: 'parse', code: 'LEGACY_CYCLE', message: `Profile 循环继承:${id}` });
    }
    visiting.add(id);
    const file = this.file(id);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (cause) {
      throw new MimicError({ phase: 'parse', code: 'LEGACY_PARENT', message: `无法读取旧 Profile:${id}`, cause });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `旧 Profile JSON 非法:${id}`, cause });
    }
    if (!isData(parsed)) throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `旧 Profile 不是对象:${id}` });
    const data = parsed as Legacy;
    const ownHash = createHash('sha256').update(text).digest('hex') as Hash;
    const parent = typeof data.meta?.extends === 'string' ? data.meta.extends : undefined;
    const ownOrigins = originsOf(data, id, ownHash);
    if (!parent) return { data, chain: [id], hashes: [ownHash], origins: ownOrigins };
    const base = await this.resolve(parent, visiting);
    const origins = { ...base.origins };
    for (const section of IDENTITY) {
      if (data[section] === undefined) continue;
      for (const key of Object.keys(origins)) if (key === section || key.startsWith(`${section}.`)) delete origins[key];
    }
    Object.assign(origins, ownOrigins);
    return {
      data: merge(base.data, data) as Legacy,
      chain: [...base.chain, id],
      hashes: [...base.hashes, ownHash],
      origins,
    };
  }

  private manifest(): Promise<ShapeManifest> {
    if (!this.shapesRoot) throw new TypeError('Shape resource root is unavailable');
    this.manifestPromise ??= (async () => {
      const file = path.join(this.shapesRoot!, 'manifest.json');
      let value: unknown;
      try {
        value = JSON.parse(await readFile(file, 'utf8')) as unknown;
      } catch (cause) {
        throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: `Shape manifest 不可读取:${file}`, cause });
      }
      if (!isData(value) || value.schema !== 1 || !isData(value.files)) {
        throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: 'Shape manifest 非法' });
      }
      for (const entry of Object.values(value.files)) {
        if (!isData(entry) || typeof entry.file !== 'string' || !entry.file
          || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
          throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: 'Shape manifest entry 非法' });
        }
      }
      return value as unknown as ShapeManifest;
    })();
    return this.manifestPromise;
  }

  private async artifactShape(data: Legacy): Promise<Shape | undefined> {
    if (!this.shapesRoot) return undefined;
    const target = deriveTarget(data);
    const id = `chromium/${target.host}/${target.platform}/${target.form}/${target.version}`;
    let loading = this.artifactShapes.get(id);
    if (!loading) {
      loading = (async () => {
        const entry = (await this.manifest()).files[id];
        if (!entry) return undefined;
        const file = path.resolve(this.shapesRoot!, entry.file);
        if (!file.startsWith(`${this.shapesRoot}${path.sep}`)) {
          throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: `Shape resource 路径越界:${id}` });
        }
        let text: string;
        try {
          text = await readFile(file, 'utf8');
        } catch (cause) {
          throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: `Shape resource 不可读取:${id}`, cause });
        }
        if (createHash('sha256').update(text).digest('hex') !== entry.sha256) {
          throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: `Shape resource checksum 不匹配:${id}` });
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch (cause) {
          throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: `Shape resource JSON 非法:${id}`, cause });
        }
        if (!isData(parsed) || parsed.schema !== 2 || parsed.id !== id || typeof parsed.hash !== 'string') {
          throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: `Shape resource 内容非法:${id}` });
        }
        return compatibleShape(parseShape(parsed), target);
      })();
      this.artifactShapes.set(id, loading);
    }
    return loading;
  }

  async load(id: string): Promise<ImportedProfile> {
    const resolved = await this.resolve(id);
    const source = sourceOf(id, resolved.data, resolved.hashes);
    const baked = await this.artifactShape(resolved.data);
    const shape = baked ?? await legacyShape(deriveTarget(resolved.data));
    const imported = importLegacyData(id, resolved.data, { source, shape });
    const ledger = ledgerOf(resolved.data, resolved.origins);
    const report: MigrationReport = {
      ...imported.report,
      chain: resolved.chain,
      meta: clone(resolved.data.meta || {}),
      ledger,
      warnings: warningsOf(resolved.data, ledger),
    };
    return { ...imported, report };
  }
}
