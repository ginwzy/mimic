/**
 * patch/keyorder —— 把目标原型的 own 键枚举顺序重排为真机(Blink)序,消除 ownKeys.order tell。
 *
 * 为何是独立的最后一道 pass(不能内联进 navigator):Navigator.prototype 的 own 键由多个 patch 共同贡献 ——
 * navigator(标量 + 接口/方法)、uadata(userAgentData)、plugins(plugins/mimeTypes)。任一未跑完就重排,
 * 其后注入的键会 append 到已排好的序之后 → 再次错序。故 after 声明全部贡献者,且注册在 patch 列表末位。
 *
 * 顺序数据源:per-host/platform/version 静态数组,authoring 时从 harness/baselines 提取。刻意不在运行时读
 * baseline —— producer(patch)不依赖 verifier(harness)的 fixture。chrome 序取自 linux-chrome-v143、webview
 * 序取自 android-webview-v138、macOS v148/v149 各取同版真机基线。Android Chrome 暂无结构基线,其表仅把
 * Chrome host 序与已知 mobile 注入差异显式合成,防止把运行时 append 顺序误当成已验证真机序。
 *
 * 覆盖面:本 pass 是**后置重排**,delete-重建的键必 append 到残留键之后,故要求原型"全 configurable"。
 * Navigator/HTMLDivElement/Document/Element/HTMLElement/EventTarget.prototype 天然全 configurable。
 * Node/Event.prototype 的 WebIDL 常量(ELEMENT_NODE… / CAPTURING_PHASE…)真机 non-configurable、jsdom 冻在末尾
 * 够不着 —— 已由 base/jsdom 在构造期放宽为 configurable 破局,本 pass 重排后再 relock 回 non-configurable。
 * host 轴:三表(Element/Document/HTMLElement.prototype)与 Navigator 均 per-host
 * (各 host 键集/键序差异及 per-host 取表根因见 ./keyorder-data)。大表逐字提取于该文件。
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
  // 两表逐字取自对应真机 baseline。v149 起 windowControlsOverlay 的 IDL 位置前移。
  chromeMac148: [
    'vendorSub', 'productSub', 'vendor', 'maxTouchPoints', 'scheduling', 'userActivation', 'geolocation',
    'doNotTrack', 'webkitTemporaryStorage', 'webkitPersistentStorage', 'hardwareConcurrency', 'cookieEnabled',
    'appCodeName', 'appName', 'appVersion', 'platform', 'product', 'userAgent', 'language', 'languages',
    'onLine', 'webdriver', 'plugins', 'mimeTypes', 'pdfViewerEnabled', 'connection', 'getGamepads',
    'javaEnabled', 'sendBeacon', 'vibrate', 'windowControlsOverlay', 'constructor',
    'deprecatedRunAdAuctionEnforcesKAnonymity', 'protectedAudience', 'bluetooth', 'clipboard', 'credentials',
    'keyboard', 'managed', 'mediaDevices', 'serviceWorker', 'virtualKeyboard', 'wakeLock', 'deviceMemory',
    'userAgentData', 'locks', 'storage', 'gpu', 'login', 'ink', 'mediaCapabilities', 'permissions',
    'devicePosture', 'hid', 'mediaSession', 'presentation', 'serial', 'usb', 'xr', 'storageBuckets',
    'adAuctionComponents', 'runAdAuction', 'canLoadAdAuctionFencedFrame', 'canShare', 'share',
    'clearAppBadge', 'getBattery', 'getUserMedia', 'requestMIDIAccess', 'requestMediaKeySystemAccess',
    'setAppBadge', 'webkitGetUserMedia', 'clearOriginJoinedAdInterestGroups', 'createAuctionNonce',
    'joinAdInterestGroup', 'leaveAdInterestGroup', 'updateAdInterestGroups', 'deprecatedReplaceInURN',
    'deprecatedURNToURL', 'getInstalledRelatedApps', 'getInterestGroupAdAuctionData', 'registerProtocolHandler',
    'unregisterProtocolHandler',
  ],
  chromeMac149: [
    'vendorSub', 'productSub', 'vendor', 'maxTouchPoints', 'scheduling', 'userActivation', 'geolocation',
    'doNotTrack', 'webkitTemporaryStorage', 'webkitPersistentStorage', 'windowControlsOverlay',
    'hardwareConcurrency', 'cookieEnabled', 'appCodeName', 'appName', 'appVersion', 'platform', 'product',
    'userAgent', 'language', 'languages', 'onLine', 'webdriver', 'plugins', 'mimeTypes', 'pdfViewerEnabled',
    'connection', 'getGamepads', 'javaEnabled', 'sendBeacon', 'vibrate', 'constructor',
    'deprecatedRunAdAuctionEnforcesKAnonymity', 'protectedAudience', 'bluetooth', 'clipboard', 'credentials',
    'keyboard', 'managed', 'mediaDevices', 'serviceWorker', 'virtualKeyboard', 'wakeLock', 'deviceMemory',
    'userAgentData', 'locks', 'storage', 'gpu', 'login', 'ink', 'mediaCapabilities', 'permissions',
    'devicePosture', 'hid', 'mediaSession', 'presentation', 'serial', 'usb', 'xr', 'storageBuckets',
    'adAuctionComponents', 'runAdAuction', 'canLoadAdAuctionFencedFrame', 'canShare', 'share',
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

// Android Chrome 沿用 Chrome host 能力集,但 mobile 轴用 contacts 替代 windowControlsOverlay。
// contacts 的相对位置取 Android WebView 基线的 userAgentData 后位置;其余顺序待真机结构 baseline 校准。
NAVIGATOR_ORDER.androidChrome = NAVIGATOR_ORDER.chrome.filter((key) => key !== 'windowControlsOverlay');
NAVIGATOR_ORDER.androidChrome.splice(NAVIGATOR_ORDER.androidChrome.indexOf('userAgentData') + 1, 0, 'contacts');

function navigatorOrder(traits) {
  if (traits.host === 'chrome' && traits.platform === 'macos') {
    return Number(traits.version) >= 149 ? NAVIGATOR_ORDER.chromeMac149 : NAVIGATOR_ORDER.chromeMac148;
  }
  if (traits.host === 'chrome' && traits.platform === 'android') return NAVIGATOR_ORDER.androidChrome;
  return NAVIGATOR_ORDER[traits.host];
}

function domOrderKey(traits) {
  return traits.host === 'chrome' && traits.platform === 'android' ? 'androidChrome' : traits.host;
}

// DOM 原型真机序(host 无关)。仅收"全 configurable"者(见上:Node/Event 受 non-configurable 常量阻塞,不入表)。
const HTML_DIV_ELEMENT_ORDER = ['align', 'constructor'];
// EventTarget.prototype:domproto 补 when 后键集补全 → 激活 order 检测。须重排,因 jsdom 把
// dispatchEvent/removeEventListener 排反、且 append 的 when 落末位(真机 when 在 constructor 前)。
// 全 configurable(webidl2js 方法 + when),后置重排可行。
const EVENT_TARGET_ORDER = ['addEventListener', 'dispatchEvent', 'removeEventListener', 'when', 'constructor'];
// Screen.prototype:screen 补 availLeft/availTop/orientation/onchange/isExtended 后键集补全。host 无关
// (webview/linux 实测同序);全 configurable(jsdom + 补的 accessor/handler),后置重排可行。真机 constructor
// 不在末位 —— onchange/isExtended 排其后,故须显式 order(非 finalizeIfaces 的 constructor 末位规则)。
const SCREEN_ORDER = ['availWidth', 'availHeight', 'width', 'height', 'colorDepth', 'pixelDepth', 'availLeft', 'availTop', 'orientation', 'constructor', 'onchange', 'isExtended'];
// Node/Event.prototype:真机序 访问器 → WebIDL 常量 → 方法 → constructor,host 无关(两基线实测同序,同 Chromium)。
// 常量经 base/jsdom 构造期放宽 configurable 后方可重排;重排后 relock 全大写常量键回 non-configurable。
const NODE_ORDER = ['nodeType', 'nodeName', 'baseURI', 'isConnected', 'ownerDocument', 'parentNode', 'parentElement', 'childNodes', 'firstChild', 'lastChild', 'previousSibling', 'nextSibling', 'nodeValue', 'textContent', 'ELEMENT_NODE', 'ATTRIBUTE_NODE', 'TEXT_NODE', 'CDATA_SECTION_NODE', 'ENTITY_REFERENCE_NODE', 'ENTITY_NODE', 'PROCESSING_INSTRUCTION_NODE', 'COMMENT_NODE', 'DOCUMENT_NODE', 'DOCUMENT_TYPE_NODE', 'DOCUMENT_FRAGMENT_NODE', 'NOTATION_NODE', 'DOCUMENT_POSITION_DISCONNECTED', 'DOCUMENT_POSITION_PRECEDING', 'DOCUMENT_POSITION_FOLLOWING', 'DOCUMENT_POSITION_CONTAINS', 'DOCUMENT_POSITION_CONTAINED_BY', 'DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC', 'appendChild', 'cloneNode', 'compareDocumentPosition', 'contains', 'getRootNode', 'hasChildNodes', 'insertBefore', 'isDefaultNamespace', 'isEqualNode', 'isSameNode', 'lookupNamespaceURI', 'lookupPrefix', 'normalize', 'removeChild', 'replaceChild', 'constructor'];
const EVENT_ORDER = ['type', 'target', 'currentTarget', 'eventPhase', 'bubbles', 'cancelable', 'defaultPrevented', 'composed', 'timeStamp', 'srcElement', 'returnValue', 'cancelBubble', 'NONE', 'CAPTURING_PHASE', 'AT_TARGET', 'BUBBLING_PHASE', 'composedPath', 'initEvent', 'preventDefault', 'stopImmediatePropagation', 'stopPropagation', 'constructor'];
const IDL_CONST = /^[A-Z][A-Z_]+$/;

export default {
  name: 'keyorder',
  // after window:DOM 原型方法/访问器由 window sweep native 化,须在其后捕获最终描述符。
  // after navigator/uadata/plugins:Navigator.prototype 键由三者共同贡献,须等键集齐备。
  // after domproto:EventTarget.prototype.when 须先补齐再重排(否则 order 缺 when)。
  after: ['window', 'navigator', 'uadata', 'plugins', 'domproto', 'screen'],
  apply({ window, mask, traits }) {
    const navOrder = navigatorOrder(traits);
    if (navOrder) mask.reorderOwnKeys(window.Navigator.prototype, navOrder);
    mask.reorderOwnKeys(window.HTMLDivElement.prototype, HTML_DIV_ELEMENT_ORDER);
    mask.reorderOwnKeys(window.EventTarget.prototype, EVENT_TARGET_ORDER);
    mask.reorderOwnKeys(window.Screen.prototype, SCREEN_ORDER);
    // Node/Event.prototype:常量已由 base/jsdom 构造期放宽 configurable → 后置重排可达;排后 relock 常量回 non-configurable。
    for (const [proto, order] of [[window.Node.prototype, NODE_ORDER], [window.Event.prototype, EVENT_ORDER]]) {
      mask.reorderOwnKeys(proto, order);
      for (const k of order) if (IDL_CONST.test(k)) Object.defineProperty(proto, k, { configurable: false });
    }
    // domproto 补全 Document/Element/HTMLElement.prototype 键集 → 激活 order 检测,据真机序重排(per-host)。
    // 仅在对应真机基线键集与 mimic 注入集相等时该原型 order 才被检视(更高版本因键集漂移而休眠,见 keyorder-data)。
    const elOrder = ELEMENT_ORDER[traits.host];
    if (elOrder) mask.reorderOwnKeys(window.Element.prototype, elOrder);
    const platformKey = domOrderKey(traits);
    const docOrder = DOCUMENT_ORDER[platformKey];
    if (docOrder) mask.reorderOwnKeys(window.Document.prototype, docOrder);
    const htmlOrder = HTML_ELEMENT_ORDER[platformKey];
    if (htmlOrder) mask.reorderOwnKeys(window.HTMLElement.prototype, htmlOrder);
  },
};
