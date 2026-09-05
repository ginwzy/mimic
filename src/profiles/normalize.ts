import { MimicError } from '../core/error.js';
import { parsePage, parseProfile } from '../core/parse.js';
import { seal } from '../core/seal.js';
import type {
  AudioData, Brand, CanvasData, Data, Evidence, JsonValue, NavigatorData, Part,
  ScreenData, Source, Support, SystemColorsData, Target, TimezoneData, UaData,
  WebGlData, WindowData,
} from '../core/types.js';
import { compatibleShape } from './shapes.js';
import type { NormalizationInput, NormalizedIdentity } from './types.js';

const clone = <T extends JsonValue>(value: T): T => structuredClone(value);
const isData = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value);

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

function evidenceOf(capturedParts: ReadonlySet<Part>, source: Source, derived: string[], sections: Partial<Record<Part, unknown>>): Record<Part, Evidence> {
  const output = {} as Record<Part, Evidence>;
  for (const part of ['navigator', 'screen', 'window', 'timezone', 'webgl', 'canvas', 'audio', 'fonts'] as Part[]) {
    const fields: Record<string, Support> = {};
    const value = sections[part];
    const captured = capturedParts.has(part);
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

/** Normalize facts independently of source format, storage and migration reports. */
export function normalizeIdentity(input: NormalizationInput): NormalizedIdentity {
  const { id, target, source, identity: data } = input;
  const shape = compatibleShape(input.shape, target);
  const derived = [...(input.derived ?? [])];
  const navigator = normalizeNavigator(data.navigator, target, derived);
  const screen = normalizeScreen(data.screen, derived);
  const window = normalizeWindow(data.window);
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
    evidence: evidenceOf(new Set(input.captured), source, derived, sections),
  }));

  const context = input.page;
  const connection = context?.connection;
  const page = context ? parsePage(seal({
    schema: 2,
    id: `${id}:default`,
    source,
    ...(context.url === undefined ? {} : { url: context.url }),
    ...(isData(connection) ? { connection: {
      effectiveType: text(connection, 'effectiveType', 'navigator.connection.effectiveType'),
      downlink: number(connection, 'downlink', 'navigator.connection.downlink'),
      rtt: number(connection, 'rtt', 'navigator.connection.rtt'),
      saveData: boolean(connection, 'saveData', 'navigator.connection.saveData'),
    } } : {}),
    ...(context.clock ? { clock: {
      now: number(context.clock, 'now', 'timing.now'),
      seed: number(context.clock, 'seed', 'timing.seed'),
    } } : {}),
  })) : undefined;

  return { profile, ...(page ? { page } : {}), shape, derived };
}
