import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ProfileRecord, ProfilesPort } from '../app/types.js';
import { MimicError } from '../core/error.js';
import { jsonCopy } from '../core/json.js';
import type { Data, Hash, JsonValue, Source, Target } from '../core/types.js';
import { importLegacyData, legacyShape, legacyTarget, type ImportedProfile } from './profiles.js';

const RAW_ROOT = '_fp-env';
const RAW_FILE = /^z__env_(\d+)\.json$/;

interface IndexedRaw {
  profileId: string;
  recordId: string;
  file: string;
  sourceFile: string;
}

function isData(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bad(message: string, cause?: unknown): never {
  throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message, ...(cause === undefined ? {} : { cause }) });
}

function missingFallback(cause: unknown): boolean {
  if (!(cause instanceof MimicError) || cause.code !== 'LEGACY_PARENT') return false;
  const parentCause = (cause as Error & { cause?: unknown }).cause;
  return (parentCause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function object(data: Data, key: string, pathName: string): Data {
  const value = data[key];
  return isData(value) ? value : bad(`fp-env 字段非法:${pathName}`);
}

function text(data: Data, key: string, pathName: string): string {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : bad(`fp-env 字段非法:${pathName}`);
}

function highEntropy(navigator: Data): Data {
  const uaData = object(navigator, 'userAgentData', 'navigator.userAgentData');
  const high = uaData.HighEntropyValues;
  return isData(high) ? high : uaData;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function profileId(raw: Data, recordId: string): { id: string; target: Target } {
  const navigator = object(raw, 'navigator', 'navigator');
  const flattened = { ...navigator, userAgentData: highEntropy(navigator) } as Data;
  const target = legacyTarget({ navigator: flattened, screen: object(raw, 'screen', 'screen') });
  const uaData = flattened.userAgentData;
  const label = isData(uaData) && typeof uaData.model === 'string' ? uaData.model : 'unknown';
  return {
    id: `${target.platform}-${target.host}/${slug(label)}-v${target.version}-${recordId}`,
    target,
  };
}

function pick(data: Data, keys: readonly string[]): Data {
  const output: Data = {};
  for (const key of keys) {
    if (data[key] !== undefined) output[key] = jsonCopy(data[key] as JsonValue);
  }
  return output;
}

function rawWebGl(raw: Data): Data | undefined {
  const collect = raw.collect1;
  if (!isData(collect) || !Array.isArray(collect.getParameter_info)) return undefined;
  const parameters = collect.getParameter_info.find(isData);
  if (!parameters || !Array.isArray(collect.canvas_webgl2_SupportedExtensions)) return undefined;
  const extensions = collect.canvas_webgl2_SupportedExtensions;
  if (extensions.some((value) => typeof value !== 'string')) return undefined;
  return {
    parameters: jsonCopy(parameters),
    extensions: jsonCopy(extensions),
    unmaskedVendor: typeof parameters['37445'] === 'string' ? parameters['37445'] : '',
    unmaskedRenderer: typeof parameters['37446'] === 'string' ? parameters['37446'] : '',
  };
}

function toLegacyInput(id: string, raw: Data, target: Target): { data: Data; derived: string[] } {
  const navigator = object(raw, 'navigator', 'navigator');
  const screen = object(raw, 'screen', 'screen');
  const ua = text(navigator, 'userAgent', 'navigator.userAgent');
  const platform = text(navigator, 'platform', 'navigator.platform');
  const rawVendor = navigator.vendor;
  const rawCookieEnabled = navigator.cookieEnabled;
  const capturedVendor = typeof rawVendor === 'string';
  const capturedCookieEnabled = typeof rawCookieEnabled === 'boolean';
  const vendor = capturedVendor ? rawVendor : 'Google Inc.';
  const cookieEnabled = capturedCookieEnabled ? rawCookieEnabled : true;
  const derived: string[] = [];
  const issues: string[] = [];
  if (!capturedVendor) {
    derived.push('navigator.vendor');
    issues.push('navigator.vendor missing; derived as Google Inc.');
  }
  if (!capturedCookieEnabled) {
    derived.push('navigator.cookieEnabled');
    issues.push('navigator.cookieEnabled missing; derived as true');
  }
  if (/armv81$/i.test(platform)) issues.push(`suspicious navigator.platform=${platform}`);
  const connection = isData(navigator.connection)
    ? pick(navigator.connection, ['effectiveType', 'downlink', 'rtt', 'saveData'])
    : undefined;
  const webgl = rawWebGl(raw);
  const windowKeys = ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio'] as const;
  const window = windowKeys.every((key) => typeof raw[key] === 'number') ? pick(raw, windowKeys) : undefined;
  const date = isData(raw.Date) ? raw.Date : undefined;
  const timezone = typeof raw['Intl.Timezone'] === 'string' && typeof date?.TimezoneOffset === 'number'
    ? { timeZone: raw['Intl.Timezone'], offset: date.TimezoneOffset }
    : undefined;
  const orientation = isData(screen.orientation)
    ? pick(screen.orientation, ['type', 'angle'])
    : undefined;
  return {
    data: {
      meta: {
        source: 'fp_env-direct',
        name: id,
        hygiene: {
          ...(typeof raw.devicePixelRatio === 'number' ? { devicePixelRatio: raw.devicePixelRatio } : {}),
          issues,
        },
        fidelity: {
          navigator: 'real', screen: 'real', window: window ? 'real' : 'absent',
          timezone: timezone ? 'real' : 'absent',
          webgl: webgl ? 'params' : 'absent', canvas: 'absent', audio: 'absent', fonts: 'absent',
        },
        traits: {
          engine: target.engine, host: target.host, platform: target.platform,
          formFactor: target.form, version: target.version,
        },
      },
      navigator: {
        ...pick(navigator, [
          'appVersion', 'platform', 'vendor', 'language', 'languages', 'hardwareConcurrency',
          'deviceMemory', 'maxTouchPoints', 'cookieEnabled',
        ]),
        userAgent: ua,
        vendor,
        cookieEnabled,
        userAgentData: jsonCopy(highEntropy(navigator)),
        ...(connection ? { connection } : {}),
      },
      screen: {
        ...pick(screen, [
          'width', 'height', 'availWidth', 'availHeight', 'availLeft', 'availTop', 'colorDepth', 'pixelDepth',
        ]),
        ...(orientation ? { orientation } : {}),
      },
      ...(window ? { window } : {}),
      ...(timezone ? { timezone } : {}),
      ...(webgl ? { webgl } : {}),
    },
    derived,
  };
}

export async function normalizeFpEnv(
  recordId: string,
  input: unknown,
  source: Source,
): Promise<ImportedProfile> {
  if (!/^\d+$/.test(recordId)) bad(`fp-env record id 非法:${recordId}`);
  if (!isData(input)) bad(`fp-env 不是对象:${recordId}`);
  const raw = jsonCopy(input) as Data;
  const identified = profileId(raw, recordId);
  const shape = await legacyShape(identified.target);
  const legacy = toLegacyInput(identified.id, raw, identified.target);
  return importLegacyData(
    identified.id,
    legacy.data,
    { source, shape, derived: legacy.derived },
  );
}

export class FpEnvProfiles implements ProfilesPort {
  readonly root: string;
  readonly rawRoot: string;
  private indexPromise: Promise<Map<string, IndexedRaw>> | undefined;
  private readonly loaded = new Map<string, Promise<ProfileRecord>>();

  constructor(root: string, private readonly fallback?: ProfilesPort) {
    this.root = path.resolve(root);
    this.rawRoot = path.join(this.root, RAW_ROOT);
  }

  async list(): Promise<string[]> {
    const ids = new Set(this.fallback ? await this.fallback.list() : []);
    for (const id of (await this.index()).keys()) ids.add(id);
    return [...ids].sort();
  }

  async load(id: string): Promise<ProfileRecord> {
    if (typeof id !== 'string' || id.length === 0) bad('Profile id 必须是非空字符串');
    if (this.fallback) {
      try {
        return await this.fallback.load(id);
      } catch (cause) {
        if (!missingFallback(cause)) throw cause;
      }
    }
    const entry = (await this.index()).get(id);
    if (!entry) bad(`fp-env Profile 不存在:${id}`);
    let loading = this.loaded.get(id);
    if (!loading) {
      loading = this.loadRaw(entry);
      this.loaded.set(id, loading);
    }
    return loading;
  }

  private index(): Promise<Map<string, IndexedRaw>> {
    this.indexPromise ??= this.buildIndex();
    return this.indexPromise;
  }

  private async buildIndex(): Promise<Map<string, IndexedRaw>> {
    const output = new Map<string, IndexedRaw>();
    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT' && directory === this.rawRoot) return;
        return bad(`fp-env 目录不可读取:${directory}`, cause);
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(file);
          continue;
        }
        const match = RAW_FILE.exec(entry.name);
        if (!entry.isFile() || !match) continue;
        const recordId = match[1]!;
        const raw = await this.readRaw(file, recordId);
        const identified = profileId(raw.value, recordId);
        if (output.has(identified.id)) bad(`fp-env Profile id 重复:${identified.id}`);
        output.set(identified.id, {
          profileId: identified.id,
          recordId,
          file,
          sourceFile: path.relative(this.root, file).split(path.sep).join('/'),
        });
      }
    };
    await walk(this.rawRoot);
    return output;
  }

  private async readRaw(file: string, recordId: string): Promise<{ text: string; value: Data }> {
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch (cause) {
      bad(`fp-env 文件不可读取:${file}`, cause);
    }
    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch (cause) {
      bad(`fp-env JSON 非法:${recordId}`, cause);
    }
    if (!isData(value)) bad(`fp-env 不是对象:${recordId}`);
    return { text: content, value };
  }

  private async loadRaw(entry: IndexedRaw): Promise<ProfileRecord> {
    const raw = await this.readRaw(entry.file, entry.recordId);
    const hash = createHash('sha256').update(raw.text).digest('hex') as Hash;
    const imported = await normalizeFpEnv(entry.recordId, raw.value, {
      kind: 'fp-env', hash, file: entry.sourceFile,
    });
    if (imported.profile.id !== entry.profileId) bad(`fp-env Profile 内容在索引后变化:${entry.profileId}`);
    return imported;
  }
}
