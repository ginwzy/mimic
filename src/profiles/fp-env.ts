import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ProfileRecord, ProfilesPort } from '../app/types.js';
import { MimicError } from '../core/error.js';
import { deepFreeze, jsonCopy } from '../core/json.js';
import type { Data, Hash, JsonValue, Source, Target } from '../core/types.js';
import { browserFacts, capturedParts, type BrowserEvidence } from './browser.js';
import { normalizeIdentity } from './normalize.js';
import { inferTarget } from './target.js';
import { shapeForTarget } from './shapes.js';
import { createReport } from './report.js';
import type { ImportedProfile } from './types.js';

const RAW_ROOT = '_fp-env';
const RAW_FILE = /^z__env_(\d+)\.json$/;
const ROOT_CACHE_LIMIT = 8;
const PROFILE_CACHE_LIMIT = 128;

interface IndexedRaw {
  profileId: string;
  recordId: string;
  file: string;
  sourceFile: string;
  stamp: string;
}

interface ProfileCache {
  files: Map<string, IndexedRaw>;
  index?: Map<string, IndexedRaw>;
  refreshing?: Promise<Map<string, IndexedRaw>>;
  loaded: Map<IndexedRaw, Promise<ProfileRecord>>;
}

const CACHES = new Map<string, ProfileCache>();

function sharedCache(root: string): ProfileCache {
  const cache = CACHES.get(root) ?? { files: new Map(), loaded: new Map() };
  CACHES.delete(root);
  CACHES.set(root, cache);
  while (CACHES.size > ROOT_CACHE_LIMIT) CACHES.delete(CACHES.keys().next().value!);
  return cache;
}

async function fileStamp(file: string): Promise<string | undefined> {
  try {
    const info = await lstat(file, { bigint: true });
    if (!info.isFile()) return undefined;
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return bad(`fp-env 文件不可读取:${file}`, cause);
  }
}

function isData(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bad(message: string, cause?: unknown): never {
  throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message, ...(cause === undefined ? {} : { cause }) });
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
  const target = inferTarget({ navigator: flattened, screen: object(raw, 'screen', 'screen') });
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

function extractEvidence(id: string, raw: Data, target: Target): { fields: BrowserEvidence; derived: string[] } {
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
    fields: {
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
  const shape = await shapeForTarget(identified.target);
  const evidence = extractEvidence(identified.id, raw, identified.target);
  const { derived, ...normalized } = normalizeIdentity({
    id: identified.id, target: identified.target, source, shape,
    ...browserFacts(evidence.fields),
    captured: capturedParts(evidence.fields.meta?.fidelity),
    derived: evidence.derived,
  });
  return { ...normalized, report: createReport(identified.id, evidence.fields, derived) };
}

export class FpEnvProfiles implements ProfilesPort {
  readonly root: string;
  readonly rawRoot: string;
  private indexed = false;
  private readonly cache: ProfileCache;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.rawRoot = path.join(this.root, RAW_ROOT);
    this.cache = sharedCache(this.root);
  }

  async list(): Promise<string[]> {
    return [...(await this.index(true)).keys()].sort();
  }

  async load(id: string): Promise<ProfileRecord> {
    if (typeof id !== 'string' || id.length === 0) bad('Profile id 必须是非空字符串');
    let entry = (await this.index()).get(id);
    if (!entry || await fileStamp(entry.file) !== entry.stamp) {
      entry = (await this.index(true)).get(id);
    }
    if (!entry) bad(`fp-env Profile 不存在:${id}; 数据目录:${this.rawRoot}`);
    const { loaded } = this.cache;
    let loading = loaded.get(entry);
    if (!loading) {
      loading = this.loadRaw(entry);
    }
    loaded.delete(entry);
    loaded.set(entry, loading);
    while (loaded.size > PROFILE_CACHE_LIMIT) loaded.delete(loaded.keys().next().value!);
    try {
      return await loading;
    } catch (cause) {
      if (loaded.get(entry) === loading) loaded.delete(entry);
      throw cause;
    }
  }

  private async index(refresh = false): Promise<Map<string, IndexedRaw>> {
    const cache = this.cache;
    // Share in-flight scans; new loaders and list() check disk without reparsing unchanged files.
    if (cache.refreshing) {
      await cache.refreshing;
    } else if (refresh || !this.indexed || !cache.index) {
      cache.refreshing = this.buildIndex();
      try {
        await cache.refreshing;
      } finally {
        delete cache.refreshing;
      }
    }
    this.indexed = true;
    return cache.index!;
  }

  private async buildIndex(): Promise<Map<string, IndexedRaw>> {
    const output = new Map<string, IndexedRaw>();
    const files = new Map<string, IndexedRaw>();
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
        const stamp = await fileStamp(file);
        if (stamp === undefined) continue;
        let indexed = this.cache.files.get(file);
        if (!indexed || indexed.stamp !== stamp) {
          const raw = await this.readRaw(file, recordId);
          if (await fileStamp(file) !== stamp) bad(`fp-env 文件在读取期间变化:${file}`);
          const identified = profileId(raw.value, recordId);
          indexed = {
            profileId: identified.id,
            recordId,
            file,
            sourceFile: path.relative(this.root, file).split(path.sep).join('/'),
            stamp,
          };
        }
        if (output.has(indexed.profileId)) bad(`fp-env Profile id 重复:${indexed.profileId}`);
        output.set(indexed.profileId, indexed);
        files.set(file, indexed);
      }
    };
    await walk(this.rawRoot);
    this.cache.files = files;
    this.cache.index = output;
    for (const entry of this.cache.loaded.keys()) {
      if (files.get(entry.file) !== entry) this.cache.loaded.delete(entry);
    }
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
    if (await fileStamp(entry.file) !== entry.stamp) bad(`fp-env 文件在读取期间变化:${entry.file}`);
    const hash = createHash('sha256').update(raw.text).digest('hex') as Hash;
    const imported = await normalizeFpEnv(entry.recordId, raw.value, {
      kind: 'fp-env', hash, file: entry.sourceFile,
    });
    if (imported.profile.id !== entry.profileId) bad(`fp-env Profile 内容在索引后变化:${entry.profileId}`);
    return deepFreeze(imported);
  }
}
