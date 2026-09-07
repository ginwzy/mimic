import { MimicError } from '../core/error.js';
import { jsonCopy } from '../core/json.js';
import { parsePage, parseProfile, parseShape } from '../core/parse.js';
import { digest, seal } from '../core/seal.js';
import type {
  AudioData, Brand, CanvasData, Data, Evidence, Form, Hash, Host, JsonValue, NavigatorData, Page, Part,
  Platform, Profile, ScreenData, Shape, Source, Support, SystemColorsData, Target, TimezoneData, UaData,
  WebGlData, WindowData,
} from '../core/types.js';

const BASELINES: Record<string, { hash: Hash; file: string }> = {
  'chromium/chrome/linux/desktop/143': {
    hash: '8bb471bc084776b3988ef08d73d10ba0eeea6d19d3af061133b3a91c1f6e6d1d' as Hash,
    file: 'resources/baselines/linux-chrome-v143.json',
  },
  'chromium/chrome/macos/desktop/148': {
    hash: '1f747c9d2d4c0964f78e59014e7acef9c4b6fa506d5809857f741a624248f105' as Hash,
    file: 'resources/baselines/macos-chrome-v148.json',
  },
  'chromium/chrome/macos/desktop/149': {
    hash: '7d1c22a4af2c78df674f8268eead5fad0ee4c19855a486a45fb08aada415800d' as Hash,
    file: 'resources/baselines/macos-chrome-v149.json',
  },
  'chromium/webview/android/mobile/138': {
    hash: 'bcd3ffb7b184eb61ab23827c1a6de256def5b3f4eb33b4bbbb9b01b7cc01bea5' as Hash,
    file: 'resources/baselines/android-webview-v138.json',
  },
};
const SHAPES = new Map<string, Shape>();

type IdentityInput = Data & {
  meta?: Data;
  navigator?: Data;
  screen?: Data;
  window?: Data;
  timezone?: Data;
  webgl?: Data;
  canvas?: Data;
  audio?: Data;
  systemColors?: Data;
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

const isData = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = <T extends JsonValue>(value: T): T => structuredClone(value);

function brands(navigator: Data): Data[] {
  const uaData = navigator.userAgentData;
  if (!isData(uaData) || !Array.isArray(uaData.brands)) return [];
  return uaData.brands.filter(isData);
}

function deriveTarget(data: IdentityInput): Target {
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
  else throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: '无法从 Identity 推导平台' });

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
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `Identity Chromium 版本证据冲突:${[...uniqueVersions].join(',')}` });
  }
  const version = Number.parseInt(versions[0] || '', 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: '无法从 Identity 推导 Chromium 版本' });
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
        code: 'BAD_PROFILE',
        message: `Identity traits.${key}=${String(traits[key])} 与证据推导值 ${String(value)} 冲突`,
      });
    }
  }
  return target;
}

function identityData(input: unknown): IdentityInput {
  let value: JsonValue;
  try {
    value = jsonCopy(input);
  } catch (cause) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: 'Identity 不是纯 JSON', cause });
  }
  if (!isData(value)) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: 'Identity 不是对象' });
  }
  return value as IdentityInput;
}

export function identityTarget(input: unknown): Target {
  return deriveTarget(identityData(input));
}

export async function targetShape(target: Target): Promise<Shape> {
  const id = `chromium/${target.host}/${target.platform}/${target.form}/${target.version}`;
  const cached = SHAPES.get(id);
  if (cached) return cached;
  const baseline = BASELINES[id];
  // Keep the existing derivation rule so unchanged Shape evidence retains its hash.
  const source: Source = baseline
    ? { kind: 'capture', hash: baseline.hash, file: baseline.file }
    : { kind: 'derived', hash: digest({ rule: 'legacy-shape-v1', target }), rule: 'legacy-shape-v1' };
  // Derived targets compile from feature tables. Dynamic so worker init stays on baked JSON.
  const { shape: builtShape } = await import('../features/shape.js');
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

function ledgerOf(data: IdentityInput, origins: Record<string, { id: string; hash: Hash }>): Record<string, LedgerEntry> {
  const ledger: Record<string, LedgerEntry> = {};
  const visit = (value: JsonValue, prefix: string) => {
    if (prefix) ledger[prefix] = { ...mapped(prefix), ...(origins[prefix] ? { source: origins[prefix] } : {}) };
    if (!isData(value)) return;
    for (const [key, child] of Object.entries(value)) visit(child, prefix ? `${prefix}.${key}` : key);
  };
  visit(data, '');
  return ledger;
}

function originsOf(data: IdentityInput, id: string, hash: Hash): Record<string, { id: string; hash: Hash }> {
  const output: Record<string, { id: string; hash: Hash }> = {};
  const visit = (value: JsonValue, prefix: string): void => {
    if (prefix) output[prefix] = { id, hash };
    if (!isData(value)) return;
    for (const [key, child] of Object.entries(value)) visit(child, prefix ? `${prefix}.${key}` : key);
  };
  visit(data, '');
  return output;
}

function warningsOf(data: IdentityInput, ledger: Record<string, LedgerEntry>): string[] {
  const warnings: string[] = [];
  const hygiene = isData(data.meta?.hygiene) ? data.meta.hygiene : undefined;
  if (Array.isArray(hygiene?.issues)) warnings.push(...hygiene.issues.filter((issue): issue is string => typeof issue === 'string'));
  const windowData = data.window;
  if (windowData && ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight'].some((key) => windowData[key] === 0)) {
    warnings.push('window geometry contains zero');
  }
  const preserved = Object.entries(ledger).filter(([, entry]) => entry.status === 'raw-preserved').map(([key]) => key);
  if (preserved.length) warnings.push(`unmapped identity paths:${preserved.join(',')}`);
  return warnings;
}

function bad(pathName: string): never {
  throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `Identity 字段非法:${pathName}` });
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
  let availLeft = 0;
  let availTop = 0;
  if (typeof data.availLeft === 'number') availLeft = number(data, 'availLeft', 'screen.availLeft');
  else derived.push('screen.availLeft');
  if (typeof data.availTop === 'number') availTop = number(data, 'availTop', 'screen.availTop');
  else derived.push('screen.availTop');
  return {
    width,
    height,
    availWidth: number(data, 'availWidth', 'screen.availWidth'),
    availHeight: number(data, 'availHeight', 'screen.availHeight'),
    availLeft,
    availTop,
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

function normalizeAudio(data: Data | undefined): AudioData | undefined {
  if (!data) return undefined;
  const reduction = Number(data.reduction);
  const sampleSum = Number(data.sampleSum);
  const freqSum = Number(data.freqSum);
  const timeSum = Number(data.timeSum);
  if (![reduction, sampleSum, freqSum, timeSum].every(Number.isFinite)) return bad('audio');
  return { reduction, sampleSum, freqSum, timeSum };
}

function normalizeSystemColors(data: Data | undefined): SystemColorsData | undefined {
  if (!data || Object.keys(data).length === 0) return undefined;
  const out: SystemColorsData = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeCanvas(data: Data | undefined): CanvasData | undefined {
  if (!data) return undefined;
  const toDataURL = data.toDataURL;
  if (typeof toDataURL !== 'string' || !toDataURL.startsWith('data:')) return undefined;
  return { toDataURL };
}

function evidenceOf(data: IdentityInput, source: Source, derived: string[], sections: Partial<Record<Part, unknown>>): Record<Part, Evidence> {
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
      message: `Shape 与Identity target 不一致:${parsed.id}`,
    });
  }
  return parsed;
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
  const shape = compatibleShape(options.shape, target);
  const inputHash = digest(data);
  const source = options.source ?? { kind: 'manual' as const, hash: inputHash };
  const navigatorRaw = clone(data.navigator);
  const connection = navigatorRaw.connection;
  delete navigatorRaw.connection;
  const windowData = data.window ? clone(data.window) : undefined;
  if (windowData) delete windowData.chrome;
  const derived = [...(options.derived ?? [])];
  const navigator = normalizeNavigator(navigatorRaw, target, derived);
  const screen = normalizeScreen(data.screen, derived);
  const window = normalizeWindow(windowData);
  const timezone = normalizeTimezone(data.timezone);
  const webgl = normalizeWebGl(data.webgl);
  const audio = normalizeAudio(data.audio);
  const systemColors = normalizeSystemColors(data.systemColors);
  const canvas = normalizeCanvas(data.canvas);
  const sections: Partial<Record<Part, unknown>> = {
    navigator, screen, window, timezone, webgl, audio, canvas,
  };

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
    ...(audio ? { audio } : {}),
    ...(systemColors ? { systemColors } : {}),
    ...(canvas ? { canvas } : {}),
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
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `Identity 含未映射字段:${unmapped.join(',')}` });
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

