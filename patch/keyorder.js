/**
 * patch/keyorder —— 把目标原型的 own 键枚举顺序重排为真机(Blink)序,消除 ownKeys.order tell。
 *
 * 为何是独立的最后一道 pass(不能内联进 navigator):Navigator.prototype 的 own 键由多个 patch 共同贡献 ——
 * navigator(标量 + 接口/方法)、uadata(userAgentData)、plugins(plugins/mimeTypes)。任一未跑完就重排,
 * 其后注入的键会 append 到已排好的序之后 → 再次错序。故 after 声明全部贡献者,且注册在 patch 列表末位。
 *
 * 顺序数据源:per-host 静态数组,是 per-(host,version) 常量(同 Chrome 版本的 Blink IDL 序与平台无关),
 * authoring 时从 harness/baselines 提取。刻意不在运行时读 baseline 文件 —— producer(patch)不依赖 verifier
 * (harness)的 fixture。chrome 序取自 linux-chrome-v143(desktop:含 windowControlsOverlay、无 contacts);
 * webview 序取自 android-webview-v138(mobile:含 contacts/connection 前置、无 chrome-only 键)。两序的键集
 * 与 patch 在对应 host 下的注入集一致(集合正确性见 diff 的 sameSet);本 pass 只改顺序。
 *
 * 当前仅 Navigator.prototype。Node/Event/HTMLDivElement.prototype 同根(jsdom 定义序≠Blink),待补各自 order
 * 数组接入同一 mask.reorderOwnKeys 机制(已知未尽项,单独推进)。
 */

// Navigator.prototype 真机 getOwnPropertyNames 序。键集随 host 门控而异 —— 用注入侧同一条 host 轴选择。
const NAVIGATOR_ORDER = {
  chrome: [
    'vendorSub', 'productSub', 'vendor', 'maxTouchPoints', 'scheduling', 'userActivation', 'geolocation',
    'doNotTrack', 'plugins', 'mimeTypes', 'pdfViewerEnabled', 'webkitTemporaryStorage', 'webkitPersistentStorage',
    'hardwareConcurrency', 'cookieEnabled', 'appCodeName', 'appName', 'appVersion', 'platform', 'product',
    'userAgent', 'language', 'languages', 'onLine', 'webdriver', 'connection', 'getGamepads', 'javaEnabled',
    'sendBeacon', 'vibrate', 'windowControlsOverlay', 'constructor', 'deprecatedRunAdAuctionEnforcesKAnonymity',
    'protectedAudience', 'clipboard', 'credentials', 'keyboard', 'managed', 'mediaDevices', 'storage',
    'serviceWorker', 'virtualKeyboard', 'wakeLock', 'deviceMemory', 'userAgentData', 'locks', 'login', 'ink',
    'mediaCapabilities', 'devicePosture', 'hid', 'mediaSession', 'permissions', 'presentation', 'serial', 'gpu',
    'usb', 'xr', 'storageBuckets', 'adAuctionComponents', 'runAdAuction', 'canLoadAdAuctionFencedFrame',
    'clearAppBadge', 'getBattery', 'getUserMedia', 'requestMIDIAccess', 'requestMediaKeySystemAccess',
    'setAppBadge', 'webkitGetUserMedia', 'clearOriginJoinedAdInterestGroups', 'createAuctionNonce',
    'joinAdInterestGroup', 'leaveAdInterestGroup', 'updateAdInterestGroups', 'deprecatedReplaceInURN',
    'deprecatedURNToURL', 'getInstalledRelatedApps', 'getInterestGroupAdAuctionData', 'registerProtocolHandler',
    'unregisterProtocolHandler',
  ],
  webview: [
    'vendorSub', 'productSub', 'vendor', 'maxTouchPoints', 'scheduling', 'userActivation', 'doNotTrack',
    'geolocation', 'connection', 'plugins', 'mimeTypes', 'pdfViewerEnabled', 'webkitTemporaryStorage',
    'webkitPersistentStorage', 'hardwareConcurrency', 'cookieEnabled', 'appCodeName', 'appName', 'appVersion',
    'platform', 'product', 'userAgent', 'language', 'languages', 'onLine', 'webdriver', 'getGamepads',
    'javaEnabled', 'sendBeacon', 'vibrate', 'constructor', 'storageBuckets', 'clipboard', 'credentials',
    'keyboard', 'managed', 'mediaDevices', 'storage', 'serviceWorker', 'virtualKeyboard', 'wakeLock',
    'deviceMemory', 'userAgentData', 'contacts', 'ink', 'mediaCapabilities', 'locks', 'gpu', 'permissions',
    'clearAppBadge', 'getBattery', 'getUserMedia', 'requestMIDIAccess', 'requestMediaKeySystemAccess',
    'setAppBadge', 'webkitGetUserMedia',
  ],
};

export default {
  name: 'keyorder',
  after: ['navigator', 'uadata', 'plugins'],
  apply({ window, mask, traits }) {
    const order = NAVIGATOR_ORDER[traits.host];
    if (order) mask.reorderOwnKeys(window.Navigator.prototype, order);
  },
};
