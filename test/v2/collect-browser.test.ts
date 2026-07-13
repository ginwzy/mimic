import assert from 'node:assert/strict';
import test from 'node:test';
import collectIdentity, {
  collectIdentity as collectIdentityNamed,
  createIdentityCollector,
} from '../../src/v2/collect/browser.js';

function chromeScope(): { scope: Window; chrome: object } {
  const chrome = { app: {} };
  Object.defineProperty(chrome, 'runtime', {
    value: {},
    configurable: true,
  });

  const parameters = new Map<number, unknown>([
    [7938, 'WebGL 2.0 Chromium'],
    [3379, 16384],
    [3386, new Int32Array([16384, 16384])],
    [37445, 'Google Inc.'],
    [37446, 'ANGLE (Apple, Apple M3, Metal)'],
  ]);
  const gl = {
    VERSION: 7938,
    MAX_TEXTURE_SIZE: 3379,
    MAX_VIEWPORT_DIMS: 3386,
    getParameter(key: number) {
      return parameters.get(key);
    },
    getSupportedExtensions() {
      return ['EXT_texture_filter_anisotropic', 'WEBGL_debug_renderer_info'];
    },
    getExtension(name: string) {
      return name === 'WEBGL_debug_renderer_info'
        ? { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 }
        : null;
    },
  };

  const scope = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/149.0.0.0',
      appVersion: '5.0 (Macintosh) AppleWebKit/537.36 Chrome/149.0.0.0',
      platform: 'MacIntel',
      vendor: 'Google Inc.',
      language: 'zh-CN',
      languages: ['zh-CN', 'zh'],
      hardwareConcurrency: 12,
      deviceMemory: 8,
      maxTouchPoints: 0,
      cookieEnabled: true,
      userAgentData: {
        brands: [{ brand: 'Chromium', version: '149' }],
        mobile: false,
        platform: 'macOS',
        async getHighEntropyValues(hints: string[]) {
          assert.deepEqual(hints, [
            'architecture',
            'bitness',
            'model',
            'platformVersion',
            'uaFullVersion',
            'fullVersionList',
            'wow64',
          ]);
          return {
            architecture: 'arm',
            bitness: '64',
            model: '',
            platformVersion: '15.6.0',
            uaFullVersion: '149.0.0.0',
            fullVersionList: [{ brand: 'Chromium', version: '149.0.0.0' }],
            wow64: false,
          };
        },
      },
      connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
    },
    screen: {
      width: 1512,
      height: 982,
      availWidth: 1512,
      availHeight: 945,
      colorDepth: 30,
      pixelDepth: 30,
      orientation: { type: 'landscape-primary', angle: 0 },
    },
    innerWidth: 1280,
    innerHeight: 800,
    outerWidth: 1280,
    outerHeight: 877,
    devicePixelRatio: 2,
    chrome,
    Intl: {
      DateTimeFormat() {
        return { resolvedOptions: () => ({ timeZone: 'Asia/Shanghai' }) };
      },
    },
    Date: class {
      getTimezoneOffset() {
        return -480;
      }
    },
    document: {
      createElement(name: string) {
        assert.equal(name, 'canvas');
        return {
          getContext(kind: string) {
            return kind === 'webgl2' ? gl : null;
          },
        };
      },
    },
  };
  return { scope: scope as unknown as Window, chrome };
}

test('collectIdentity captures host evidence and JSON-safe browser identity without changing the scope', async () => {
  const { scope, chrome } = chromeScope();
  const scopeKeys = Reflect.ownKeys(scope);
  const navigatorKeys = Reflect.ownKeys(scope.navigator);
  const screenKeys = Reflect.ownKeys(scope.screen);
  const chromeDescriptors = Object.getOwnPropertyDescriptors(chrome);

  const identity = await collectIdentity(scope);

  assert.equal(collectIdentity, collectIdentityNamed);
  assert.deepEqual(JSON.parse(JSON.stringify(identity)), identity);
  assert.deepEqual(identity.navigator, {
    userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/149.0.0.0',
    appVersion: '5.0 (Macintosh) AppleWebKit/537.36 Chrome/149.0.0.0',
    platform: 'MacIntel',
    vendor: 'Google Inc.',
    language: 'zh-CN',
    languages: ['zh-CN', 'zh'],
    hardwareConcurrency: 12,
    deviceMemory: 8,
    maxTouchPoints: 0,
    cookieEnabled: true,
    userAgentData: {
      brands: [{ brand: 'Chromium', version: '149' }],
      mobile: false,
      platform: 'macOS',
      architecture: 'arm',
      bitness: '64',
      model: '',
      platformVersion: '15.6.0',
      uaFullVersion: '149.0.0.0',
      fullVersionList: [{ brand: 'Chromium', version: '149.0.0.0' }],
      wow64: false,
    },
    connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
  });
  assert.deepEqual(identity.window, {
    innerWidth: 1280,
    innerHeight: 800,
    outerWidth: 1280,
    outerHeight: 877,
    devicePixelRatio: 2,
    chrome: { ownKeys: ['app', 'runtime'] },
  });
  assert.deepEqual(identity.screen, {
    width: 1512,
    height: 982,
    availWidth: 1512,
    availHeight: 945,
    colorDepth: 30,
    pixelDepth: 30,
    orientation: { type: 'landscape-primary', angle: 0 },
  });
  assert.deepEqual(identity.timezone, { timeZone: 'Asia/Shanghai', offset: -480 });
  assert.deepEqual(identity.webgl, {
    parameters: {
      '3379': 16384,
      '3386': [16384, 16384],
      '7938': 'WebGL 2.0 Chromium',
      '37445': 'Google Inc.',
      '37446': 'ANGLE (Apple, Apple M3, Metal)',
    },
    extensions: ['EXT_texture_filter_anisotropic', 'WEBGL_debug_renderer_info'],
    unmaskedVendor: 'Google Inc.',
    unmaskedRenderer: 'ANGLE (Apple, Apple M3, Metal)',
  });
  assert.deepEqual(identity.meta, {
    source: 'capture',
    hygiene: {
      devicePixelRatio: 2,
      issues: ['devicePixelRatio=2(桌面非 1 可能是缩放或高 DPI 屏,影响渲染类指纹)'],
    },
    fidelity: {
      navigator: 'real',
      screen: 'real',
      window: 'real',
      timezone: 'real',
      webgl: 'params',
      canvas: 'absent',
      audio: 'absent',
      fonts: 'absent',
    },
  });

  assert.deepEqual(Reflect.ownKeys(scope), scopeKeys);
  assert.deepEqual(Reflect.ownKeys(scope.navigator), navigatorKeys);
  assert.deepEqual(Reflect.ownKeys(scope.screen), screenKeys);
  assert.deepEqual(Object.getOwnPropertyDescriptors(chrome), chromeDescriptors);
  assert.equal(Object.hasOwn(scope, '__capture__'), false);
});

test('collector binding keeps WebView host absence and restricted capabilities explicit', async () => {
  const scope = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/138.0.0.0 Mobile',
      appVersion: '5.0 (Linux; Android 14; wv) Chrome/138.0.0.0 Mobile',
      platform: 'Linux armv81',
      vendor: 'Google Inc.',
      language: 'en-US',
      languages: ['en-US'],
      hardwareConcurrency: 8,
      deviceMemory: 4,
      maxTouchPoints: 5,
      cookieEnabled: true,
      userAgentData: {
        brands: [{ brand: 'Android WebView', version: '138' }],
        mobile: true,
        platform: 'Android',
        async getHighEntropyValues() {
          throw new Error('not a secure context');
        },
      },
    },
    screen: {
      width: 412,
      height: 915,
      availWidth: 412,
      availHeight: 915,
      colorDepth: 24,
      pixelDepth: 24,
    },
    innerWidth: 412,
    innerHeight: 915,
    outerWidth: 412,
    outerHeight: 915,
    devicePixelRatio: 2.625,
    Intl: {
      DateTimeFormat() {
        return { resolvedOptions: () => ({ timeZone: 'UTC' }) };
      },
    },
    Date: class {
      getTimezoneOffset() {
        return 0;
      }
    },
    document: {
      createElement() {
        return { getContext: () => null };
      },
    },
  } as unknown as Window;
  const keys = Reflect.ownKeys(scope);

  const identity = await createIdentityCollector(scope)();

  assert.deepEqual(identity.window, {
    innerWidth: 412,
    innerHeight: 915,
    outerWidth: 412,
    outerHeight: 915,
    devicePixelRatio: 2.625,
    chrome: null,
  });
  assert.deepEqual(identity.navigator.userAgentData, {
    brands: [{ brand: 'Android WebView', version: '138' }],
    mobile: true,
    platform: 'Android',
  });
  assert.equal(Object.hasOwn(identity, 'webgl'), false);
  assert.equal((identity.meta.fidelity as Record<string, string>).webgl, 'absent');
  assert.deepEqual(Reflect.ownKeys(scope), keys);
  assert.deepEqual(JSON.parse(JSON.stringify(identity)), identity);
});
