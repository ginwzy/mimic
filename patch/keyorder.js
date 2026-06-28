/**
 * patch/keyorder —— 把目标原型的 own 键枚举顺序重排为真机(Blink)序,消除 ownKeys.order tell。
 *
 * 为何是独立的最后一道 pass(不能内联进 navigator):Navigator.prototype 的 own 键由多个 patch 共同贡献 ——
 * navigator(标量 + 接口/方法)、uadata(userAgentData)、plugins(plugins/mimeTypes)。任一未跑完就重排,
 * 其后注入的键会 append 到已排好的序之后 → 再次错序。故 after 声明全部贡献者,且注册在 patch 列表末位。
 *
 * 顺序数据源:per-host 静态数组(per-(host,version) 常量,Blink IDL 序与平台无关),authoring 时从
 * harness/baselines 提取。刻意不在运行时读 baseline —— producer(patch)不依赖 verifier(harness)的 fixture。
 * chrome 序取自 linux-chrome-v143、webview 序取自 android-webview-v138;两序键集与对应 host 注入集一致
 * (集合正确性见 diff 的 sameSet),本 pass 只改顺序。
 *
 * 覆盖面与机制边界:本 pass 是**后置重排**,delete 后重建的键必然 append 到残留键之后,故仅适用于"全
 * configurable"的原型(Navigator/HTMLDivElement/Document/Element/HTMLElement/EventTarget.prototype ✓,均实测
 * 零 non-configurable own 键)。Node/Event.prototype 做不到:真机序里 configurable accessors 排在
 * non-configurable WebIDL 常量(ELEMENT_NODE… / CAPTURING_PHASE…)**之前**,但 jsdom 把常量冻结在末尾删不动,
 * 后置重排插不到其前 —— 须在 jsdom 原型构造期拦截(更深的技术,本 pass 不覆盖)。
 * host 轴:事件处理器密集的 Document/HTMLElement.prototype 真机序**随 host 而异**(实测 chrome-v143 vs
 * webview-v138 共享键 100+ 处错位)→ per-host 表;Element.prototype 序 host 无关(实测共享序一致)→ 单表;
 * Navigator 因 host 门控键集而异 → per-host。大表逐字提取于 ./keyorder-data(见该文件)。
 */
import { ELEMENT_ORDER, DOCUMENT_ORDER, HTML_ELEMENT_ORDER } from './keyorder-data.js';

// Navigator.prototype 真机 getOwnPropertyNames 序。键集随 host 门控而异 —— 用注入侧同一条 host 轴选择。
// 导出供 authoring 期 harness/gen-keyorder 校验(与 keyorder-data 三表同源,逐元素比对 baseline)。
export const NAVIGATOR_ORDER = {
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

// DOM 原型真机序(host 无关)。仅收"全 configurable"者(见上:Node/Event 受 non-configurable 常量阻塞,不入表)。
const HTML_DIV_ELEMENT_ORDER = ['align', 'constructor'];
// EventTarget.prototype:domproto 补 when 后键集补全 → 激活 order 检测。须重排,因 jsdom 把
// dispatchEvent/removeEventListener 排反、且 append 的 when 落末位(真机 when 在 constructor 前)。
// 全 configurable(webidl2js 方法 + when),后置重排可行。
const EVENT_TARGET_ORDER = ['addEventListener', 'dispatchEvent', 'removeEventListener', 'when', 'constructor'];

export default {
  name: 'keyorder',
  // after window:DOM 原型方法/访问器由 window sweep native 化,须在其后捕获最终描述符。
  // after navigator/uadata/plugins:Navigator.prototype 键由三者共同贡献,须等键集齐备。
  // after domproto:EventTarget.prototype.when 须先补齐再重排(否则 order 缺 when)。
  after: ['window', 'navigator', 'uadata', 'plugins', 'domproto'],
  apply({ window, mask, traits }) {
    const navOrder = NAVIGATOR_ORDER[traits.host];
    if (navOrder) mask.reorderOwnKeys(window.Navigator.prototype, navOrder);
    mask.reorderOwnKeys(window.HTMLDivElement.prototype, HTML_DIV_ELEMENT_ORDER);
    mask.reorderOwnKeys(window.EventTarget.prototype, EVENT_TARGET_ORDER);
    // domproto 补全 Document/Element/HTMLElement.prototype 键集 → 激活 order 检测,据真机序重排(per-host)。
    // 仅在对应真机基线键集与 mimic 注入集相等时该原型 order 才被检视(更高版本因键集漂移而休眠,见 keyorder-data)。
    const elOrder = ELEMENT_ORDER[traits.host];
    if (elOrder) mask.reorderOwnKeys(window.Element.prototype, elOrder);
    const docOrder = DOCUMENT_ORDER[traits.host];
    if (docOrder) mask.reorderOwnKeys(window.Document.prototype, docOrder);
    const htmlOrder = HTML_ELEMENT_ORDER[traits.host];
    if (htmlOrder) mask.reorderOwnKeys(window.HTMLElement.prototype, htmlOrder);
  },
};
