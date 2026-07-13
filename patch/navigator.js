/**
 * patch/navigator —— 把 jsdom 的 navigator 改造成 profile 指定的 Chrome navigator。
 * 在 jsdom 原生 Navigator 原型上以 getter 覆盖,保留原型链与 instanceof。
 *
 * 三层分离(对照 Apify fingerprint-injector 的 data/util-fn、Camoufox 的 config/引擎):
 *   数据层  —— profile.section('navigator') + traits(已在别处分离;此处只读)。
 *   形状层  —— 下方三张声明式表:scalars(apply 内,绑 profile 值)、methodTable、ifaceTable。
 *              每行带可选 gate(指纹一致性约束,见 ./gates)。
 *   机制层  —— mask 原语 + apply 内的通用 driver 循环;不含任何"哪个 API/哪个值"的知识。
 * 新增/删改成员 = 改对应表一行,driver 不动。
 */
import { chromeHost, mobileOnly, desktopOnly, macosChrome } from './gates.js';

// data 方法形状表:[名, arity, 实现, gate?]。壳语义:void→resolve、复杂对象→pending、回调签名→无返回。
function methodTable(mask) {
  const { promise, pending, adopt } = mask;
  return [
    ['getGamepads', 0, () => adopt([])],
    ['sendBeacon', 1, () => true],
    ['vibrate', 1, () => true],
    ['clearAppBadge', 0, () => promise(undefined)],
    ['getBattery', 0, () => pending()],
    ['getUserMedia', 3, () => undefined],
    ['requestMIDIAccess', 0, () => pending()],
    ['requestMediaKeySystemAccess', 2, () => pending()],
    ['setAppBadge', 0, () => promise(undefined)],
    ['webkitGetUserMedia', 3, () => undefined],
    ['adAuctionComponents', 1, () => adopt([]), chromeHost],
    ['runAdAuction', 1, () => pending(), chromeHost],
    ['canLoadAdAuctionFencedFrame', 0, () => false, chromeHost],
    ['clearOriginJoinedAdInterestGroups', 1, () => pending(), chromeHost],
    ['createAuctionNonce', 0, () => '', chromeHost],
    ['joinAdInterestGroup', 1, () => pending(), chromeHost],
    ['leaveAdInterestGroup', 0, () => pending(), chromeHost],
    ['updateAdInterestGroups', 0, () => undefined, chromeHost],
    ['deprecatedReplaceInURN', 2, () => promise(undefined), chromeHost],
    ['deprecatedURNToURL', 1, () => pending(), chromeHost],
    ['getInstalledRelatedApps', 0, () => promise(adopt([])), chromeHost],
    ['getInterestGroupAdAuctionData', 1, () => pending(), chromeHost],
    ['registerProtocolHandler', 2, () => undefined, chromeHost],
    ['unregisterProtocolHandler', 2, () => undefined, chromeHost],
    ['canShare', 0, () => false, macosChrome],
    ['share', 0, () => pending(), macosChrome],
  ];
}

// 接口单例形状表:{ cls, methods?, props?, gate? } → mask.singleton,driver 透传。
// eager 建实例保 === 不变量;多数刻意不插 EventTarget 层(避免 jsdom brand-check)。
function ifaceTable(mask, createPermissionStatus) {
  const { promise, pending, adopt } = mask;
  return {
    // ── always:真机无条件存在 / secure-context chrome+webview 共有 ───────────────────────
    permissions: { cls: 'Permissions', methods: {
      query: [1, (d) => promise(createPermissionStatus(d && d.name, 'prompt'))],
    } },
    geolocation: { cls: 'Geolocation', methods: {
      getCurrentPosition: [1, () => undefined], watchPosition: [1, () => 0], clearWatch: [1, () => undefined],
    } },
    userActivation: { cls: 'UserActivation', props: { hasBeenActive: false, isActive: false } },
    scheduling: { cls: 'Scheduling', methods: { isInputPending: [0, () => false] } },
    mediaCapabilities: { cls: 'MediaCapabilities', methods: {
      decodingInfo: [1, () => promise(adopt({ supported: false, smooth: false, powerEfficient: false }))],
      encodingInfo: [1, () => promise(adopt({ supported: false, smooth: false, powerEfficient: false }))],
    } },
    ink: { cls: 'Ink', methods: { requestPresenter: [1, () => promise(undefined)] } },
    clipboard: { cls: 'Clipboard', methods: {
      read: [0, () => pending()], readText: [0, () => pending()],
      write: [1, () => pending()], writeText: [1, () => pending()],
    } },
    credentials: { cls: 'CredentialsContainer', methods: {
      create: [0, () => pending()], get: [0, () => pending()],
      preventSilentAccess: [0, () => promise(undefined)], store: [1, () => pending()],
    } },
    keyboard: { cls: 'Keyboard', methods: {
      getLayoutMap: [0, () => pending()], lock: [0, () => promise(undefined)], unlock: [0, () => undefined],
    } },
    managed: { cls: 'NavigatorManagedData' },
    mediaDevices: { cls: 'MediaDevices', methods: {
      enumerateDevices: [0, () => promise(adopt([]))], getDisplayMedia: [1, () => pending()],
      getSupportedConstraints: [0, () => adopt({})], getUserMedia: [1, () => pending()],
    }, eventHandlers: ['ondevicechange'] },
    storage: { cls: 'StorageManager', methods: {
      estimate: [0, () => promise(adopt({ quota: 0, usage: 0 }))], getDirectory: [0, () => pending()],
      persist: [0, () => promise(false)], persisted: [0, () => promise(false)],
    } },
    serviceWorker: { cls: 'ServiceWorkerContainer', methods: {
      getRegistration: [0, () => pending()], getRegistrations: [0, () => promise(adopt([]))],
      register: [1, () => pending()], startMessages: [0, () => undefined],
    }, props: { controller: null }, eventHandlers: ['oncontrollerchange', 'onmessage', 'onmessageerror'] },
    virtualKeyboard: { cls: 'VirtualKeyboard', props: { overlaysContent: false } },
    wakeLock: { cls: 'WakeLock', methods: { request: [0, () => pending()] } },
    locks: { cls: 'LockManager', methods: { query: [0, () => pending()], request: [2, () => pending()] } },
    gpu: { cls: 'GPU', methods: {
      getPreferredCanvasFormat: [0, () => 'bgra8unorm'], requestAdapter: [0, () => promise(null)],
    } },
    storageBuckets: { cls: 'StorageBucketManager', methods: {
      delete: [1, () => pending()], keys: [0, () => promise(adopt([]))], open: [1, () => pending()],
    } },

    // ── host 轴:WebView 缺的 Chrome 专属 secure-context 接口 ───────────────────────────────
    login: { cls: 'NavigatorLogin', methods: { setStatus: [1, () => pending()] }, gate: chromeHost },
    devicePosture: { cls: 'DevicePosture', props: { type: 'continuous' }, gate: chromeHost },
    hid: { cls: 'HID', methods: {
      getDevices: [0, () => promise(adopt([]))], requestDevice: [1, () => promise(adopt([]))],
    }, gate: chromeHost },
    presentation: { cls: 'Presentation', props: { defaultRequest: null, receiver: null }, gate: chromeHost },
    bluetooth: { cls: 'Bluetooth', methods: {
      getAvailability: [0, () => promise(false)], getDevices: [0, () => promise(adopt([]))],
      requestDevice: [0, () => pending()],
    }, eventHandlers: ['onavailabilitychanged'], parentEventTarget: true, gate: macosChrome },
    serial: { cls: 'Serial', methods: {
      getPorts: [0, () => promise(adopt([]))], requestPort: [0, () => pending()],
    }, gate: chromeHost },
    usb: { cls: 'USB', methods: {
      getDevices: [0, () => promise(adopt([]))], requestDevice: [1, () => pending()],
    }, gate: chromeHost },
    xr: { cls: 'XRSystem', methods: {
      isSessionSupported: [1, () => promise(false)], requestSession: [1, () => pending()],
    }, gate: chromeHost },
    protectedAudience: { cls: 'ProtectedAudience', methods: { queryFeatureSupport: [1, () => adopt({})] }, gate: chromeHost },
    // mediaSession 不在此表:host 形态分裂(chrome 原型 accessor / WebView 实例 own data),见 apply 特例。

    // ── formFactor 轴:平台差(异于上面的 host 差)──────────────────────────────────────────
    // Contacts Picker:Android 专属(移动端 chrome+webview 皆有、桌面无)。
    contacts: { cls: 'ContactsManager', methods: {
      getProperties: [0, () => promise(adopt([]))], select: [2, () => pending()],
    }, gate: mobileOnly },
    // windowControlsOverlay:桌面 PWA 专属、移动端无。
    windowControlsOverlay: { cls: 'WindowControlsOverlay', methods: {
      getTitlebarAreaRect: [0, () => adopt({ x: 0, y: 0, width: 0, height: 0 })],
    }, props: { visible: false }, gate: desktopOnly },
  };
}

export default {
  name: 'navigator',
  after: [],
  apply({ window, profile, mask, traits }) {
    const p = profile.section('navigator');
    const nav = window.navigator;
    const proto = window.Navigator.prototype;
    const mobile = traits.formFactor === 'mobile';
    const passes = (gate) => !gate || gate(traits);

    // ── 形状层:标量指纹(绑 profile 值)。
    mask.mixin(nav, {
      userAgent: () => p.userAgent ?? nav.userAgent,
      appVersion: () => p.appVersion ?? nav.appVersion,
      platform: () => p.platform ?? 'Win32',
      vendor: () => p.vendor ?? 'Google Inc.',
      language: () => p.language ?? 'en-US',
      languages: () => [...(p.languages ?? ['en-US', 'en'])],
      hardwareConcurrency: () => p.hardwareConcurrency ?? 8,
      deviceMemory: () => p.deviceMemory ?? 8,
      maxTouchPoints: () => p.maxTouchPoints ?? (mobile ? 5 : 0), // 移动端默认有触点,桌面 0
      webdriver: () => false,
      // 真机 Chrome 桌面 pdfViewerEnabled=true、doNotTrack=null;WebView 无 PDF 插件 → false。
      pdfViewerEnabled: () => traits.host === 'chrome',
      doNotTrack: () => null,
    });

    // ── 机制层 driver:data 方法(jsdom 已有则不覆盖)。
    for (const [name, len, impl, gate] of methodTable(mask)) {
      if (!passes(gate) || name in proto) continue;
      mask.method(proto, name, len, impl);
    }

    // ── 机制层 driver:接口单例 accessor(=== 不变量,见 ifaceTable 表注)。
    const accessors = {};
    const permissionState = new WeakMap();
    const permissionStatus = mask.iface('PermissionStatus');
    mask.instAccessors(permissionStatus.proto, {
      name: function () { return permissionState.get(this)?.name; },
      state: function () { return permissionState.get(this)?.state || 'prompt'; },
    });
    mask.eventHandler(permissionStatus.proto, 'onchange');
    const createPermissionStatus = (name, state) => {
      const status = permissionStatus.create();
      permissionState.set(status, { name, state });
      return status;
    };

    for (const [key, { cls, methods = {}, props = {}, eventHandlers = [], parentEventTarget = false, gate }] of Object.entries(ifaceTable(mask, createPermissionStatus))) {
      if (!passes(gate)) continue;
      const inst = mask.singleton(cls, {
        methods, props, eventHandlers,
        ...(parentEventTarget ? { parent: window.EventTarget.prototype } : {}),
      });
      accessors[key] = () => inst;
    }
    // chrome-only 非接口标量(不入 ifaceTable)。
    if (chromeHost(traits)) accessors.deprecatedRunAdAuctionEnforcesKAnonymity = () => true;

    // ── 特例:connection 数据来自 profile → 裸 iface;缺省则整属性不存在。
    //    全装原型 accessor(非实例 own,L2 基线实例为空)。
    if (p.connection) {
      const ni = mask.iface('NetworkInformation');
      const c = p.connection;
      const readonly = {};
      for (const k of Object.keys(c)) readonly[k] = () => c[k];
      mask.accessors(ni.proto, readonly);
      mask.eventHandler(ni.proto, 'onchange');
      const conn = ni.create();
      accessors.connection = () => conn;
    }
    // ── 特例:webkit{Temporary,Persistent}Storage 同类两实例(singleton 表达不了),走底层 iface。
    const quota = mask.iface('DeprecatedStorageQuota');
    mask.methods(quota.proto, { queryUsageAndQuota: [2, () => undefined], requestQuota: [2, () => undefined] });
    const webkitTemporaryStorage = quota.create();
    const webkitPersistentStorage = quota.create();
    accessors.webkitTemporaryStorage = () => webkitTemporaryStorage;
    accessors.webkitPersistentStorage = () => webkitPersistentStorage;

    // 特例:mediaSession 形态 host 分裂[实测]——桌面/移动 Chrome 在 Navigator.prototype(accessor);
    // WebView 真机改挂 navigator 实例 own data property(无 prototype getter,对照基线 navigator ownKeys=['mediaSession'])。
    const mediaSession = mask.singleton('MediaSession', {
      methods: { setActionHandler: [2, () => undefined], setPositionState: [1, () => undefined] },
      props: { metadata: null, playbackState: 'none' },
    });
    if (chromeHost(traits)) accessors.mediaSession = () => mediaSession;
    else Object.defineProperty(nav, 'mediaSession', { value: mediaSession, writable: true, enumerable: true, configurable: true });

    mask.mixin(nav, accessors);
  },
};
