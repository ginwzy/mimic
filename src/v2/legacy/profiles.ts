import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { MimicError } from '../core/error.js';
import { deepFreeze, jsonCopy } from '../core/json.js';
import { parsePage, parseProfile, parseShape } from '../core/parse.js';
import { digest, seal } from '../core/seal.js';
import { shape as builtShape } from '../features/index.js';
import type {
  Brand, Data, Evidence, Form, Hash, Host, JsonValue, NavigatorData, Page, Part, Platform,
  Profile, ScreenData, Shape, Source, Support, Target, TimezoneData, UaData, WebGlData, WindowData,
} from '../core/types.js';

const IDENTITY = new Set(['canvas', 'webgl', 'audio', 'fonts']);
const BASELINES: Record<string, { hash: Hash; file: string }> = {
  'chromium/chrome/linux/desktop/143': {
    hash: '8bb471bc084776b3988ef08d73d10ba0eeea6d19d3af061133b3a91c1f6e6d1d' as Hash,
    file: 'resources/v2/baselines/linux-chrome-v143.json',
  },
  'chromium/chrome/macos/desktop/148': {
    hash: '1f747c9d2d4c0964f78e59014e7acef9c4b6fa506d5809857f741a624248f105' as Hash,
    file: 'resources/v2/baselines/macos-chrome-v148.json',
  },
  'chromium/chrome/macos/desktop/149': {
    hash: '7d1c22a4af2c78df674f8268eead5fad0ee4c19855a486a45fb08aada415800d' as Hash,
    file: 'resources/v2/baselines/macos-chrome-v149.json',
  },
  'chromium/webview/android/mobile/138': {
    hash: 'bcd3ffb7b184eb61ab23827c1a6de256def5b3f4eb33b4bbbb9b01b7cc01bea5' as Hash,
    file: 'resources/v2/baselines/android-webview-v138.json',
  },
};
const SHAPES = new Map<string, Shape>();

type Legacy = Data & {
  meta?: Data;
  navigator?: Data;
  screen?: Data;
  window?: Data;
  timezone?: Data;
  webgl?: Data;
  canvas?: Data;
  audio?: Data;
  fonts?: Data;
  location?: Data;
  timing?: Data;
};

export interface LedgerEntry {
  status: 'mapped' | 'consumed' | 'raw-preserved';
  target?: string;
  source?: { id: string; hash: Hash };
}

export interface MigrationReport {
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
  report: MigrationReport;
}

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

const isData = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value);
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

function brands(navigator: Data): Data[] {
  const uaData = navigator.userAgentData;
  if (!isData(uaData) || !Array.isArray(uaData.brands)) return [];
  return uaData.brands.filter(isData);
}

function deriveTarget(data: Legacy): Target {
  const navigator = data.navigator || {};
  const uaData = isData(navigator.userAgentData) ? navigator.userAgentData : undefined;
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  const windowData = data.window || {};
  const hasChromeEvidence = Object.prototype.hasOwnProperty.call(windowData, 'chrome');

  let host: Host;
  if (hasChromeEvidence) host = windowData.chrome == null ? 'webview' : 'chrome';
  else if (brands(navigator).some((brand) => String(brand.brand || '').includes('Android WebView'))) host = 'webview';
  else if (uaData && (Array.isArray(uaData.brands) || typeof uaData.platform === 'string' || typeof uaData.mobile === 'boolean')) host = 'chrome';
  else host = /\bwv\b/.test(ua) ? 'webview' : 'chrome';

  const platformLabel = typeof uaData?.platform === 'string' ? uaData.platform.toLowerCase() : '';
  let platform: Platform;
  if (platformLabel.includes('android') || /Android/.test(ua)) platform = 'android';
  else if (platformLabel.includes('mac') || /Macintosh/.test(ua)) platform = 'macos';
  else if (platformLabel.includes('win') || /Windows/.test(ua)) platform = 'windows';
  else if (platformLabel.includes('linux') || /Linux/.test(ua)) platform = 'linux';
  else throw new MimicError({ phase: 'parse', code: 'LEGACY_ENGINE', message: '无法从旧 Profile 推导平台' });

  const form: Form = typeof uaData?.mobile === 'boolean'
    ? (uaData.mobile ? 'mobile' : 'desktop')
    : (/Mobile/.test(ua) ? 'mobile' : 'desktop');

  const versions = [
    (ua.match(/Chrom(?:e|ium)\/(\d+)/) || [])[1],
    typeof uaData?.uaFullVersion === 'string' && uaData.uaFullVersion ? uaData.uaFullVersion.split('.')[0] : undefined,
    ...brands(navigator)
      .filter((brand) => /Google Chrome|Chromium|Android WebView/.test(String(brand.brand || '')))
      .map((brand) => String(brand.version || '').split('.')[0]),
  ].filter((value): value is string => Boolean(value));
  const uniqueVersions = new Set(versions);
  if (uniqueVersions.size > 1) {
    throw new MimicError({ phase: 'parse', code: 'LEGACY_TRAITS', message: `旧 Profile Chromium 版本证据冲突:${[...uniqueVersions].join(',')}` });
  }
  const version = Number.parseInt(versions[0] || '', 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new MimicError({ phase: 'parse', code: 'LEGACY_ENGINE', message: '无法从旧 Profile 推导 Chromium 版本' });
  }

  const target: Target = { engine: 'chromium', host, platform, form, version };

  const traits = isData(data.meta?.traits) ? data.meta.traits : {};
  const expected: Record<string, JsonValue> = {
    engine: target.engine,
    host: target.host,
    platform: target.platform,
    formFactor: target.form,
    version: target.version,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (traits[key] !== undefined && traits[key] !== value) {
      throw new MimicError({
        phase: 'parse',
        code: 'LEGACY_TRAITS',
        message: `旧 Profile traits.${key}=${String(traits[key])} 与证据推导值 ${String(value)} 冲突`,
      });
    }
  }
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

export function legacyShape(target: Target): Shape {
  const id = `chromium/${target.host}/${target.platform}/${target.form}/${target.version}`;
  const cached = SHAPES.get(id);
  if (cached) return cached;
  const baseline = BASELINES[id];
  const source: Source = baseline
    ? { kind: 'capture', hash: baseline.hash, file: baseline.file }
    : { kind: 'derived', hash: digest({ rule: 'legacy-shape-v1', target }), rule: 'legacy-shape-v1' };
  const shape = builtShape(parseShape(seal({
    schema: 2 as const,
    id,
    target,
    level: baseline ? 'captured' as const : 'derived' as const,
    source,
    features: [],
    ops: [],
    support: { structure: baseline ? 'captured' : 'derived' },
  })));
  SHAPES.set(id, shape);
  return shape;
}

function sourceOf(id: string, data: Legacy, hashes: Hash[]): Source {
  const source = data.meta?.source;
  const kind: Source['kind'] = source === 'capture'
    ? 'capture'
    : (typeof source === 'string' && source.startsWith('fp_env') ? 'fp-env' : 'manual');
  const hash = createHash('sha256').update(JSON.stringify(hashes)).digest('hex') as Hash;
  return { kind, hash, file: `profiles/${id}.json` };
}

function mapped(pathName: string): LedgerEntry {
  if (pathName === 'navigator.connection' || pathName.startsWith('navigator.connection.')) {
    return { status: 'mapped', target: pathName.replace('navigator.connection', 'page.connection') };
  }
  if (pathName === 'location' || pathName === 'location.href') {
    return { status: 'mapped', target: pathName.replace('location.href', 'page.url').replace('location', 'page') };
  }
  if (pathName === 'timing' || pathName === 'timing.now' || pathName === 'timing.seed') {
    return { status: 'mapped', target: pathName.replace('timing', 'page.clock') };
  }
  if (pathName === 'window.chrome' || pathName.startsWith('window.chrome.')) {
    return { status: 'consumed', target: 'shape.host' };
  }
  if (pathName === 'meta' || pathName.startsWith('meta.')) return { status: 'consumed' };
  if (pathName === 'navigator') return { status: 'mapped', target: 'profile.navigator' };
  const nav = new Set(['userAgent', 'appVersion', 'platform', 'vendor', 'language', 'languages', 'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints', 'cookieEnabled']);
  if (pathName.startsWith('navigator.') && nav.has(pathName.slice('navigator.'.length))) return { status: 'mapped', target: `profile.${pathName}` };
  const ua = new Set(['brands', 'mobile', 'platform', 'architecture', 'bitness', 'fullVersionList', 'model', 'platformVersion', 'uaFullVersion', 'wow64']);
  if (pathName === 'navigator.userAgentData' || (pathName.startsWith('navigator.userAgentData.') && ua.has(pathName.slice('navigator.userAgentData.'.length)))) {
    return { status: 'mapped', target: `profile.${pathName}` };
  }
  if (pathName === 'screen') return { status: 'mapped', target: 'profile.screen' };
  const screen = new Set(['width', 'height', 'availWidth', 'availHeight', 'availLeft', 'availTop', 'colorDepth', 'pixelDepth', 'orientation', 'orientation.type', 'orientation.angle']);
  if (pathName.startsWith('screen.') && screen.has(pathName.slice('screen.'.length))) return { status: 'mapped', target: `profile.${pathName}` };
  if (pathName === 'window') return { status: 'mapped', target: 'profile.window' };
  const windowKeys = new Set(['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio']);
  if (pathName.startsWith('window.') && windowKeys.has(pathName.slice('window.'.length))) return { status: 'mapped', target: `profile.${pathName}` };
  if (pathName === 'timezone' || pathName === 'timezone.timeZone' || pathName === 'timezone.offset') return { status: 'mapped', target: `profile.${pathName}` };
  if (pathName === 'webgl' || pathName === 'webgl.parameters' || pathName.startsWith('webgl.parameters.')
    || pathName === 'webgl.extensions' || pathName === 'webgl.unmaskedVendor' || pathName === 'webgl.unmaskedRenderer'
    || pathName === 'webgl.shaderPrecision' || pathName.startsWith('webgl.shaderPrecision.')) {
    return { status: 'mapped', target: `profile.${pathName}` };
  }
  return { status: 'raw-preserved' };
}

function ledgerOf(data: Legacy, origins: Record<string, { id: string; hash: Hash }>): Record<string, LedgerEntry> {
  const ledger: Record<string, LedgerEntry> = {};
  const visit = (value: JsonValue, prefix: string) => {
    if (prefix) ledger[prefix] = { ...mapped(prefix), ...(origins[prefix] ? { source: origins[prefix] } : {}) };
    if (!isData(value)) return;
    for (const [key, child] of Object.entries(value)) visit(child, prefix ? `${prefix}.${key}` : key);
  };
  visit(data, '');
  return ledger;
}

function originsOf(data: Legacy, id: string, hash: Hash): Record<string, { id: string; hash: Hash }> {
  const output: Record<string, { id: string; hash: Hash }> = {};
  const visit = (value: JsonValue, prefix: string): void => {
    if (prefix) output[prefix] = { id, hash };
    if (!isData(value)) return;
    for (const [key, child] of Object.entries(value)) visit(child, prefix ? `${prefix}.${key}` : key);
  };
  visit(data, '');
  return output;
}

function warningsOf(data: Legacy, ledger: Record<string, LedgerEntry>): string[] {
  const warnings: string[] = [];
  const hygiene = isData(data.meta?.hygiene) ? data.meta.hygiene : undefined;
  if (Array.isArray(hygiene?.issues)) warnings.push(...hygiene.issues.filter((issue): issue is string => typeof issue === 'string'));
  const windowData = data.window;
  if (windowData && ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight'].some((key) => windowData[key] === 0)) {
    warnings.push('window geometry contains zero');
  }
  const preserved = Object.entries(ledger).filter(([, entry]) => entry.status === 'raw-preserved').map(([key]) => key);
  if (preserved.length) warnings.push(`unmapped legacy paths:${preserved.join(',')}`);
  return warnings;
}

function bad(pathName: string): never {
  throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `旧 Profile 字段非法:${pathName}` });
}

function text(data: Data, key: string, pathName: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : bad(pathName);
}

function number(data: Data, key: string, pathName: string): number {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : bad(pathName);
}

function boolean(data: Data, key: string, pathName: string): boolean {
  const value = data[key];
  return typeof value === 'boolean' ? value : bad(pathName);
}

function brandList(value: JsonValue | undefined, pathName: string): Brand[] {
  if (!Array.isArray(value)) return bad(pathName);
  return value.map((item, index) => {
    if (!isData(item) || typeof item.brand !== 'string' || typeof item.version !== 'string') return bad(`${pathName}.${index}`);
    return { brand: item.brand, version: item.version };
  });
}

function derivedUa(ua: string, target: Target): UaData {
  const major = String(target.version);
  const full = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || `${major}.0.0.0`;
  const mobile = target.form === 'mobile';
  const platform = { android: 'Android', linux: 'Linux', macos: 'macOS', windows: 'Windows' }[target.platform];
  const brands = [
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
    { brand: 'Not_A Brand', version: '24' },
  ];
  const fullVersionList = [
    { brand: 'Chromium', version: full },
    { brand: 'Google Chrome', version: full },
    { brand: 'Not_A Brand', version: '24.0.0.0' },
  ];
  const android = (ua.match(/Android (\d+)/) || [])[1];
  return {
    brands,
    mobile,
    platform,
    architecture: mobile ? '' : 'x86',
    bitness: mobile ? '' : '64',
    fullVersionList,
    model: '',
    platformVersion: target.platform === 'android' ? `${android || '0'}.0.0` : '',
    uaFullVersion: full,
    wow64: false,
  };
}

function normalizeUa(value: JsonValue | undefined, ua: string, target: Target, derived: string[]): UaData {
  const base = derivedUa(ua, target);
  if (value === undefined) {
    derived.push('navigator.userAgentData');
    return base;
  }
  if (!isData(value)) return bad('navigator.userAgentData');
  const stringField = (key: keyof UaData): string => {
    const child = value[key];
    if (child === undefined) {
      derived.push(`navigator.userAgentData.${key}`);
      return base[key] as string;
    }
    return typeof child === 'string' ? child : bad(`navigator.userAgentData.${key}`);
  };
  const boolField = (key: 'mobile' | 'wow64'): boolean => {
    const child = value[key];
    if (child === undefined) {
      derived.push(`navigator.userAgentData.${key}`);
      return base[key];
    }
    return typeof child === 'boolean' ? child : bad(`navigator.userAgentData.${key}`);
  };
  const listField = (key: 'brands' | 'fullVersionList'): Brand[] => {
    const child = value[key];
    if (child === undefined) {
      derived.push(`navigator.userAgentData.${key}`);
      return base[key];
    }
    return brandList(child, `navigator.userAgentData.${key}`);
  };
  return {
    brands: listField('brands'),
    mobile: boolField('mobile'),
    platform: stringField('platform'),
    architecture: stringField('architecture'),
    bitness: stringField('bitness'),
    fullVersionList: listField('fullVersionList'),
    model: stringField('model'),
    platformVersion: stringField('platformVersion'),
    uaFullVersion: stringField('uaFullVersion'),
    wow64: boolField('wow64'),
  };
}

function normalizeNavigator(data: Data, target: Target, derived: string[]): NavigatorData {
  const ua = text(data, 'userAgent', 'navigator.userAgent');
  const appVersion = typeof data.appVersion === 'string'
    ? data.appVersion
    : (derived.push('navigator.appVersion'), ua.replace(/^Mozilla\//, ''));
  const language = text(data, 'language', 'navigator.language');
  if (!Array.isArray(data.languages) || data.languages.length === 0 || data.languages.some((item) => typeof item !== 'string' || !item)) {
    return bad('navigator.languages');
  }
  const maxTouchPoints = typeof data.maxTouchPoints === 'number'
    ? data.maxTouchPoints
    : (derived.push('navigator.maxTouchPoints'), target.form === 'mobile' ? 5 : 0);
  return {
    userAgent: ua,
    appVersion,
    platform: text(data, 'platform', 'navigator.platform'),
    vendor: text(data, 'vendor', 'navigator.vendor'),
    language,
    languages: data.languages as string[],
    hardwareConcurrency: number(data, 'hardwareConcurrency', 'navigator.hardwareConcurrency'),
    deviceMemory: number(data, 'deviceMemory', 'navigator.deviceMemory'),
    maxTouchPoints,
    cookieEnabled: boolean(data, 'cookieEnabled', 'navigator.cookieEnabled'),
    userAgentData: normalizeUa(data.userAgentData, ua, target, derived),
  };
}

function normalizeScreen(data: Data, derived: string[]): ScreenData {
  const width = number(data, 'width', 'screen.width');
  const height = number(data, 'height', 'screen.height');
  const orientation = isData(data.orientation) ? data.orientation : undefined;
  if (!orientation) derived.push('screen.orientation');
  derived.push('screen.availLeft', 'screen.availTop');
  return {
    width,
    height,
    availWidth: number(data, 'availWidth', 'screen.availWidth'),
    availHeight: number(data, 'availHeight', 'screen.availHeight'),
    availLeft: 0,
    availTop: 0,
    colorDepth: number(data, 'colorDepth', 'screen.colorDepth'),
    pixelDepth: number(data, 'pixelDepth', 'screen.pixelDepth'),
    orientation: orientation
      ? { type: text(orientation, 'type', 'screen.orientation.type'), angle: number(orientation, 'angle', 'screen.orientation.angle') }
      : { type: 'landscape-primary', angle: 0 },
  };
}

function normalizeWindow(data: Data | undefined): WindowData | undefined {
  if (!data || Object.keys(data).length === 0) return undefined;
  return {
    innerWidth: number(data, 'innerWidth', 'window.innerWidth'),
    innerHeight: number(data, 'innerHeight', 'window.innerHeight'),
    outerWidth: number(data, 'outerWidth', 'window.outerWidth'),
    outerHeight: number(data, 'outerHeight', 'window.outerHeight'),
    devicePixelRatio: number(data, 'devicePixelRatio', 'window.devicePixelRatio'),
  };
}

function normalizeTimezone(data: Data | undefined): TimezoneData | undefined {
  if (!data) return undefined;
  return { timeZone: text(data, 'timeZone', 'timezone.timeZone'), offset: number(data, 'offset', 'timezone.offset') };
}

function normalizeWebGl(data: Data | undefined): WebGlData | undefined {
  if (!data) return undefined;
  if (!isData(data.parameters) || !Array.isArray(data.extensions)) return bad('webgl');
  const vendor = typeof data.unmaskedVendor === 'string' ? data.unmaskedVendor : String(data.parameters['37445'] || '');
  const renderer = typeof data.unmaskedRenderer === 'string' ? data.unmaskedRenderer : String(data.parameters['37446'] || '');
  const shaderPrecision = isData(data.shaderPrecision)
    ? clone(data.shaderPrecision) as unknown as NonNullable<WebGlData['shaderPrecision']>
    : undefined;
  return {
    parameters: clone(data.parameters) as WebGlData['parameters'],
    extensions: data.extensions.map((item) => typeof item === 'string' ? item : bad('webgl.extensions')),
    unmaskedVendor: vendor,
    unmaskedRenderer: renderer,
    ...(shaderPrecision ? { shaderPrecision } : {}),
  };
}

function evidenceOf(data: Legacy, source: Source, derived: string[], sections: Partial<Record<Part, unknown>>): Record<Part, Evidence> {
  const fidelity = isData(data.meta?.fidelity) ? data.meta.fidelity : {};
  const output = {} as Record<Part, Evidence>;
  for (const part of ['navigator', 'screen', 'window', 'timezone', 'webgl', 'canvas', 'audio', 'fonts'] as Part[]) {
    const fields: Record<string, Support> = {};
    const value = sections[part];
    const captured = fidelity[part] === 'real' || fidelity[part] === 'params';
    const base: Support = captured ? 'captured' : 'derived';
    const visit = (child: unknown, prefix: string): void => {
      if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
        for (const [key, nested] of Object.entries(child)) visit(nested, prefix ? `${prefix}.${key}` : key);
      } else if (prefix) {
        fields[prefix] = base;
      }
    };
    if (value !== undefined) visit(value, '');
    const prefix = `${part}.`;
    for (const pathName of derived.filter((name) => name === part || name.startsWith(prefix))) {
      const field = pathName === part ? '' : pathName.slice(prefix.length);
      for (const key of Object.keys(fields)) if (!field || key === field || key.startsWith(`${field}.`)) fields[key] = 'derived';
    }
    const support: Support = value === undefined ? 'unsupported' : Object.values(fields).includes('derived') ? 'derived' : base;
    output[part] = { support, fields, source };
  }
  return output;
}

function compatibleShape(shape: Shape, target: Target): Shape {
  const parsed = parseShape(shape);
  const id = `chromium/${target.host}/${target.platform}/${target.form}/${target.version}`;
  const fields = ['engine', 'host', 'platform', 'form', 'version'] as const;
  if (parsed.id !== id || fields.some((field) => parsed.target[field] !== target[field])) {
    throw new MimicError({
      phase: 'parse',
      code: 'BAD_SHAPE',
      message: `Shape 与旧 Profile target 不一致:${parsed.id}`,
    });
  }
  return parsed;
}

export function importLegacyData(
  id: string,
  input: unknown,
  options: { source?: Source; shape?: Shape } = {},
): ImportedProfile {
  const data = legacyData(input);
  if (!isData(data.navigator) || !isData(data.screen)) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `旧 Profile 缺少 navigator 或 screen:${id}` });
  }
  const name = data.meta?.name;
  if (name !== id) {
    throw new MimicError({ phase: 'parse', code: 'LEGACY_NAME', message: `Profile 名称 ${String(name)} 与路径 ${id} 不符` });
  }

  const target = deriveTarget(data);
  const shape = options.shape ? compatibleShape(options.shape, target) : legacyShape(target);
  const inputHash = digest(data);
  const source = options.source || sourceOf(id, data, [inputHash]);
  const navigatorRaw = clone(data.navigator);
  const connection = navigatorRaw.connection;
  delete navigatorRaw.connection;
  const windowData = data.window ? clone(data.window) : undefined;
  if (windowData) delete windowData.chrome;
  const derived: string[] = [];
  const navigator = normalizeNavigator(navigatorRaw, target, derived);
  const screen = normalizeScreen(data.screen, derived);
  const window = normalizeWindow(windowData);
  const timezone = normalizeTimezone(data.timezone);
  const webgl = normalizeWebGl(data.webgl);
  const sections: Partial<Record<Part, unknown>> = { navigator, screen, window, timezone, webgl };

  const profile = parseProfile(seal({
    schema: 2,
    id,
    target,
    shape: { id: shape.id, hash: shape.hash },
    source,
    navigator,
    screen,
    ...(window ? { window } : {}),
    ...(timezone ? { timezone } : {}),
    ...(webgl ? { webgl } : {}),
    evidence: evidenceOf(data, source, derived, sections),
  }));

  const hasPage = data.location !== undefined || data.timing !== undefined || isData(connection);
  const page = hasPage ? parsePage(seal({
    schema: 2,
    id: `${id}:default`,
    source,
    ...(typeof data.location?.href === 'string' ? { url: data.location.href } : {}),
    ...(isData(connection) ? { connection: {
      effectiveType: text(connection, 'effectiveType', 'navigator.connection.effectiveType'),
      downlink: number(connection, 'downlink', 'navigator.connection.downlink'),
      rtt: number(connection, 'rtt', 'navigator.connection.rtt'),
      saveData: boolean(connection, 'saveData', 'navigator.connection.saveData'),
    } } : {}),
    ...(data.timing ? { clock: {
      now: number(data.timing, 'now', 'timing.now'),
      seed: number(data.timing, 'seed', 'timing.seed'),
    } } : {}),
  })) : undefined;

  const origins = originsOf(data, id, inputHash);
  const ledger = ledgerOf(data, origins);
  const unmapped = Object.entries(ledger).filter(([, entry]) => entry.status === 'raw-preserved').map(([pathName]) => pathName);
  if (unmapped.length) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `旧 Profile 含未映射字段:${unmapped.join(',')}` });
  }
  const report: MigrationReport = {
    id,
    chain: [id],
    meta: clone(data.meta || {}),
    ledger,
    warnings: warningsOf(data, ledger),
    derived,
  };
  return { profile, ...(page ? { page } : {}), shape, report };
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
    const shape = await this.artifactShape(resolved.data);
    const imported = importLegacyData(id, resolved.data, { source, ...(shape === undefined ? {} : { shape }) });
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
