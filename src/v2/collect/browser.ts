type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;
type HostObject = Record<PropertyKey, unknown>;

export interface IdentityCapture {
  readonly meta: {
    readonly source: 'capture';
    readonly hygiene: {
      readonly devicePixelRatio?: number;
      readonly issues: readonly string[];
    };
    readonly fidelity: {
      readonly navigator: 'real';
      readonly screen: 'real';
      readonly window: 'real';
      readonly timezone: 'real';
      readonly webgl: 'params' | 'absent';
      readonly canvas: 'absent';
      readonly audio: 'absent';
      readonly fonts: 'absent';
    };
  };
  readonly navigator: JsonObject;
  readonly screen: JsonObject;
  readonly window: JsonObject;
  readonly timezone: JsonObject;
  readonly webgl?: JsonObject;
}

const HIGH_ENTROPY_HINTS = [
  'architecture',
  'bitness',
  'model',
  'platformVersion',
  'uaFullVersion',
  'fullVersionList',
  'wow64',
] as const;

const WEBGL_PARAMETERS = [
  'VERSION',
  'SHADING_LANGUAGE_VERSION',
  'VENDOR',
  'RENDERER',
  'MAX_TEXTURE_SIZE',
  'MAX_VIEWPORT_DIMS',
  'MAX_RENDERBUFFER_SIZE',
  'MAX_VERTEX_ATTRIBS',
  'MAX_VERTEX_UNIFORM_VECTORS',
  'MAX_FRAGMENT_UNIFORM_VECTORS',
  'MAX_VARYING_VECTORS',
  'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
  'MAX_TEXTURE_IMAGE_UNITS',
  'MAX_CUBE_MAP_TEXTURE_SIZE',
  'ALIASED_LINE_WIDTH_RANGE',
  'ALIASED_POINT_SIZE_RANGE',
] as const;

function hostObject(value: unknown): HostObject | undefined {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? value as HostObject
    : undefined;
}

function read(source: unknown, key: PropertyKey): unknown {
  const object = hostObject(source);
  if (!object) return undefined;
  try {
    return object[key];
  } catch {
    return undefined;
  }
}

function primitive(value: unknown): JsonPrimitive | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function put(output: JsonObject, key: string, value: unknown): void {
  const clean = primitive(value);
  if (clean !== undefined) output[key] = clean;
}

function stringList(value: unknown): string[] | undefined {
  if (typeof value === 'string' || value === null || value === undefined) return undefined;
  const length = read(value, 'length');
  if (!Number.isSafeInteger(length) || (length as number) < 0) return undefined;
  const output: string[] = [];
  for (let index = 0; index < (length as number); index++) {
    const item = read(value, index);
    if (typeof item !== 'string') return undefined;
    output.push(item);
  }
  return output;
}

function brandList(value: unknown): JsonValue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const output: JsonValue[] = [];
  for (const item of value) {
    const brand = read(item, 'brand');
    const version = read(item, 'version');
    if (typeof brand !== 'string' || typeof version !== 'string') return undefined;
    output.push({ brand, version });
  }
  return output;
}

function glValue(value: unknown): JsonPrimitive | JsonPrimitive[] | undefined {
  const scalar = primitive(value);
  if (scalar !== undefined) return scalar;

  let values: unknown[];
  if (Array.isArray(value)) values = value;
  else if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    values = Array.from(value as unknown as ArrayLike<unknown>);
  } else return undefined;

  const output: JsonPrimitive[] = [];
  for (const item of values) {
    const clean = primitive(item);
    if (clean === undefined) return undefined;
    output.push(clean);
  }
  return output;
}

function copyUaData(value: unknown): Promise<JsonObject> {
  const uaData = hostObject(value);
  const output: JsonObject = {};
  if (!uaData) return Promise.resolve(output);

  const lowBrands = brandList(read(uaData, 'brands'));
  if (lowBrands) output.brands = lowBrands;
  put(output, 'mobile', read(uaData, 'mobile'));
  put(output, 'platform', read(uaData, 'platform'));

  const getHighEntropyValues = read(uaData, 'getHighEntropyValues');
  if (typeof getHighEntropyValues !== 'function') return Promise.resolve(output);

  return Promise.resolve(Reflect.apply(getHighEntropyValues, uaData, [HIGH_ENTROPY_HINTS]))
    .then((high) => {
      for (const key of ['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion'] as const) {
        put(output, key, read(high, key));
      }
      const fullVersionList = brandList(read(high, 'fullVersionList'));
      if (fullVersionList) output.fullVersionList = fullVersionList;
      put(output, 'wow64', read(high, 'wow64'));
      return output;
    })
    .catch(() => output);
}

async function captureNavigator(scope: Window): Promise<JsonObject> {
  const navigator = read(scope, 'navigator');
  const output: JsonObject = {};
  for (const key of [
    'userAgent',
    'appVersion',
    'platform',
    'vendor',
    'language',
    'hardwareConcurrency',
    'deviceMemory',
    'maxTouchPoints',
    'cookieEnabled',
  ] as const) {
    put(output, key, read(navigator, key));
  }

  const languages = stringList(read(navigator, 'languages'));
  if (languages) output.languages = languages;

  const uaData = read(navigator, 'userAgentData');
  if (hostObject(uaData)) output.userAgentData = await copyUaData(uaData);

  const connection = read(navigator, 'connection');
  if (hostObject(connection)) {
    const clean: JsonObject = {};
    for (const key of ['effectiveType', 'downlink', 'rtt', 'saveData'] as const) {
      put(clean, key, read(connection, key));
    }
    output.connection = clean;
  }
  return output;
}

function captureScreen(scope: Window): JsonObject {
  const screen = read(scope, 'screen');
  const output: JsonObject = {};
  for (const key of ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth'] as const) {
    put(output, key, read(screen, key));
  }
  const sourceOrientation = read(screen, 'orientation');
  if (hostObject(sourceOrientation)) {
    const orientation: JsonObject = {};
    put(orientation, 'type', read(sourceOrientation, 'type'));
    put(orientation, 'angle', read(sourceOrientation, 'angle'));
    if (Object.keys(orientation).length) output.orientation = orientation;
  }
  return output;
}

function captureWindow(scope: Window): JsonObject {
  const output: JsonObject = {};
  for (const key of ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio'] as const) {
    put(output, key, read(scope, key));
  }

  const chrome = read(scope, 'chrome');
  if (hostObject(chrome)) {
    let ownKeys: string[] = [];
    try {
      ownKeys = Object.getOwnPropertyNames(chrome);
    } catch {
      // Presence remains useful host evidence even when a proxy hides its keys.
    }
    output.chrome = { ownKeys };
  } else {
    output.chrome = null;
  }
  return output;
}

function captureTimezone(scope: Window): JsonObject {
  const output: JsonObject = {};
  try {
    const intl = read(scope, 'Intl');
    const create = read(intl, 'DateTimeFormat');
    if (typeof create === 'function') {
      const formatter = Reflect.apply(create, intl, []);
      const resolvedOptions = read(formatter, 'resolvedOptions');
      if (typeof resolvedOptions === 'function') {
        const options = Reflect.apply(resolvedOptions, formatter, []);
        put(output, 'timeZone', read(options, 'timeZone'));
      }
    }
  } catch {
    // Keep independently collectable fields when one browser API is restricted.
  }

  try {
    const DateConstructor = read(scope, 'Date');
    if (typeof DateConstructor === 'function') {
      const date = Reflect.construct(DateConstructor, []);
      const getTimezoneOffset = read(date, 'getTimezoneOffset');
      if (typeof getTimezoneOffset === 'function') {
        put(output, 'offset', Reflect.apply(getTimezoneOffset, date, []));
      }
    }
  } catch {
    // Offset is optional raw evidence rather than a reason to lose the session.
  }
  return output;
}

function captureWebGl(scope: Window): JsonObject | undefined {
  try {
    const document = read(scope, 'document');
    const createElement = read(document, 'createElement');
    if (typeof createElement !== 'function') return undefined;
    const canvas = Reflect.apply(createElement, document, ['canvas']);
    const getContext = read(canvas, 'getContext');
    if (typeof getContext !== 'function') return undefined;
    const gl = Reflect.apply(getContext, canvas, ['webgl2'])
      ?? Reflect.apply(getContext, canvas, ['webgl']);
    if (!hostObject(gl)) return undefined;

    const getParameter = read(gl, 'getParameter');
    if (typeof getParameter !== 'function') return undefined;
    const parameters: JsonObject = {};
    for (const name of WEBGL_PARAMETERS) {
      const key = read(gl, name);
      if (typeof key !== 'number' || !Number.isFinite(key)) continue;
      try {
        const value = glValue(Reflect.apply(getParameter, gl, [key]));
        if (value !== undefined) parameters[String(key)] = value;
      } catch {
        // WebGL implementations can reject individual enum values.
      }
    }

    const output: JsonObject = { parameters, extensions: [] };
    const getSupportedExtensions = read(gl, 'getSupportedExtensions');
    if (typeof getSupportedExtensions === 'function') {
      try {
        const extensions = stringList(Reflect.apply(getSupportedExtensions, gl, []));
        if (extensions) output.extensions = extensions;
      } catch {
        // Preserve the parameter table if extension enumeration is blocked.
      }
    }

    const getExtension = read(gl, 'getExtension');
    if (typeof getExtension === 'function') {
      try {
        const debug = Reflect.apply(getExtension, gl, ['WEBGL_debug_renderer_info']);
        const vendorKey = read(debug, 'UNMASKED_VENDOR_WEBGL');
        const rendererKey = read(debug, 'UNMASKED_RENDERER_WEBGL');
        if (typeof vendorKey === 'number') {
          const vendor = glValue(Reflect.apply(getParameter, gl, [vendorKey]));
          if (vendor !== undefined) parameters[String(vendorKey)] = vendor;
          if (typeof vendor === 'string') output.unmaskedVendor = vendor;
        }
        if (typeof rendererKey === 'number') {
          const renderer = glValue(Reflect.apply(getParameter, gl, [rendererKey]));
          if (renderer !== undefined) parameters[String(rendererKey)] = renderer;
          if (typeof renderer === 'string') output.unmaskedRenderer = renderer;
        }
      } catch {
        // Debug renderer evidence is optional and may be privacy-blocked.
      }
    }
    return output;
  } catch {
    return undefined;
  }
}

function captureHygiene(scope: Window, navigator: JsonObject): JsonObject {
  const output: JsonObject = { issues: [] };
  const issues = output.issues as JsonValue[];
  const dpr = primitive(read(scope, 'devicePixelRatio'));
  if (typeof dpr === 'number') output.devicePixelRatio = dpr;

  const userAgent = navigator.userAgent;
  if (typeof dpr === 'number' && typeof userAgent === 'string' && !/Mobile/.test(userAgent) && dpr !== 1) {
    issues.push(`devicePixelRatio=${dpr}(桌面非 1 可能是缩放或高 DPI 屏,影响渲染类指纹)`);
  }
  const outerWidth = primitive(read(scope, 'outerWidth'));
  const innerWidth = primitive(read(scope, 'innerWidth'));
  if (typeof outerWidth === 'number' && typeof innerWidth === 'number' && Math.abs(outerWidth - innerWidth) > 200) {
    issues.push('窗口可能被缩放');
  }
  return output;
}

export async function collectIdentity(scope?: Window): Promise<IdentityCapture> {
  const target = scope ?? browserScope();
  const navigator = await captureNavigator(target);
  const webgl = captureWebGl(target);
  const fidelity: JsonObject = {
    navigator: 'real',
    screen: 'real',
    window: 'real',
    timezone: 'real',
    webgl: webgl ? 'params' : 'absent',
    canvas: 'absent',
    audio: 'absent',
    fonts: 'absent',
  };
  const output: JsonObject = {
    meta: {
      source: 'capture',
      hygiene: captureHygiene(target, navigator),
      fidelity,
    },
    navigator,
    screen: captureScreen(target),
    window: captureWindow(target),
    timezone: captureTimezone(target),
  };
  if (webgl) output.webgl = webgl;
  return output as unknown as IdentityCapture;
}

export function createIdentityCollector(scope?: Window): () => Promise<IdentityCapture> {
  return () => collectIdentity(scope);
}

function browserScope(): Window {
  if (typeof window === 'undefined') throw new TypeError('collectIdentity requires a browser Window');
  return window;
}

export default collectIdentity;
