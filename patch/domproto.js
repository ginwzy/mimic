/**
 * patch/domproto —— 补 jsdom 缺失的 DOM 原型成员(方法 + 访问器)于 Document/Element/HTMLElement/
 * EventTarget.prototype。边界:globals 管 window 全局,navigator 管 Navigator;此处只管 DOM 原型。
 * 形态契约见 mask 头注(只写一次)。行为取安全默认;可写反射属性的非 null 默认见下方反射块。
 * 补成员后 keyorder 须注册真机序(键集补全 → 激活 order 检测)。
 * arity = 真机基线 fn.length;chromeHost 门控 = WebView 无的 Chrome 实验面。
 */
import { chromeHost } from './gates.js';
import { makeTokenList, refreshTokenList } from '../base/jsdom.js';

const hasOwn = Object.prototype.hasOwnProperty;

export default {
  name: 'domproto',
  after: ['window'],
  apply({ window, mask, traits }) {
    const W = window;
    const { method, accessor, eventHandler, reflectAccessor, adopt, pending } = mask;
    // 每个 impl 必须是独立函数对象(mask.fn 原地改写,共享引用会互相覆盖 name/length)。
    const documentMethods = [
      ['caretPositionFromPoint', 2, () => null],
      ['caretRangeFromPoint', 0, () => null],
      ['elementFromPoint', 2, () => null],
      ['elementsFromPoint', 2, () => adopt([])],
      ['execCommand', 1, () => false],
      ['exitFullscreen', 0, () => pending()],
      ['exitPictureInPicture', 0, () => pending()],
      ['exitPointerLock', 0, () => undefined],
      ['getAnimations', 0, () => adopt([])],
      ['hasStorageAccess', 0, () => W.Promise.resolve(false)],
      ['hasUnpartitionedCookieAccess', 0, () => W.Promise.resolve(false)],
      ['moveBefore', 2, () => undefined],
      ['queryCommandEnabled', 1, () => false],
      ['queryCommandIndeterm', 1, () => false],
      ['queryCommandState', 1, () => false],
      ['queryCommandSupported', 1, () => false],
      ['queryCommandValue', 1, () => ''],
      ['requestStorageAccess', 0, () => pending()],
      ['requestStorageAccessFor', 1, () => pending()],
      ['startViewTransition', 0, () => adopt({})],
      ['webkitCancelFullScreen', 0, () => undefined],
      ['webkitExitFullscreen', 0, () => undefined],
      // Chrome 隐私沙箱面(WebView 缺 → chromeHost):
      ['ariaNotify', 1, () => undefined, chromeHost],
      ['browsingTopics', 0, () => pending(), chromeHost],
      ['hasPrivateToken', 1, () => W.Promise.resolve(false), chromeHost],
      ['hasRedemptionRecord', 1, () => W.Promise.resolve(false), chromeHost],
    ];

    const elementMethods = [
      ['animate', 1, () => adopt({})],
      ['checkVisibility', 0, () => true],
      ['computedStyleMap', 0, () => adopt({})],
      ['getAnimations', 0, () => adopt([])],
      ['getHTML', 0, () => ''],
      ['hasPointerCapture', 1, () => false],
      ['moveBefore', 2, () => undefined],
      ['releasePointerCapture', 1, () => undefined],
      ['requestFullscreen', 0, () => pending()],
      ['requestPointerLock', 0, () => pending()],
      ['scroll', 0, () => undefined],
      ['scrollBy', 0, () => undefined],
      ['scrollIntoView', 0, () => undefined],
      ['scrollIntoViewIfNeeded', 0, () => undefined],
      ['scrollTo', 0, () => undefined],
      ['setHTMLUnsafe', 1, () => undefined],
      ['setPointerCapture', 1, () => undefined],
      ['webkitRequestFullScreen', 0, () => undefined],
      ['webkitRequestFullscreen', 0, () => undefined],
      ['ariaNotify', 1, () => undefined, chromeHost],
    ];

    const htmlElementMethods = [
      ['hidePopover', 0, () => undefined],
      ['showPopover', 0, () => undefined],
      ['togglePopover', 0, () => false], // 返回切换后是否可见
    ];

    // EventTarget.prototype.when:Observable(新标准)。
    const eventTargetMethods = [
      ['when', 1, () => adopt({})],
    ];

    const install = (proto, table) => {
      for (const [name, len, impl, gate] of table) {
        if (gate && !gate(traits)) continue;       // 平台/host 差异方法门控(据真机基线)
        if (hasOwn.call(proto, name)) continue;    // jsdom 已具(形态错则属 TELL,另判),不覆盖
        method(proto, name, len, impl);
      }
    };

    install(W.Document.prototype, documentMethods);
    install(W.Element.prototype, elementMethods);
    install(W.HTMLElement.prototype, htmlElementMethods);
    install(W.EventTarget.prototype, eventTargetMethods);

    // ── 访问器 ──────────────────────────────────────────────────────────────
    // GETSET:get+set 形态。涵盖 on* 事件处理器与可写反射 IDL 属性(名单据真机基线 accessor.get+set 判定)。
    const documentGetSet = [
      'adoptedStyleSheets', 'alinkColor', 'bgColor', 'designMode', 'domain', 'fgColor', 'fullscreen',
      'fullscreenElement', 'fullscreenEnabled', 'linkColor', 'onanimationend', 'onanimationiteration',
      'onanimationstart', 'onbeforecopy', 'onbeforecut', 'onbeforepaste', 'onbeforexrselect', 'oncommand',
      'oncontentvisibilityautostatechange', 'onfreeze', 'onfullscreenchange', 'onfullscreenerror', 'onmousewheel',
      'onpointerlockchange', 'onpointerlockerror', 'onprerenderingchange', 'onresume', 'onscrollsnapchange',
      'onscrollsnapchanging', 'onsearch', 'onselectionchange', 'onselectstart', 'ontransitioncancel',
      'ontransitionend', 'ontransitionrun', 'ontransitionstart', 'onwebkitfullscreenchange',
      'onwebkitfullscreenerror', 'vlinkColor', 'xmlStandalone', 'xmlVersion',
    ];
    const elementGetSet = [
      'ariaActiveDescendantElement', 'ariaBrailleLabel', 'ariaBrailleRoleDescription', 'ariaControlsElements',
      'ariaDescribedByElements', 'ariaDetailsElements', 'ariaErrorMessageElements', 'ariaFlowToElements',
      'ariaLabelledByElements', 'elementTiming', 'onbeforecopy', 'onbeforecut', 'onbeforepaste',
      'onfullscreenchange', 'onfullscreenerror', 'onsearch', 'onwebkitfullscreenchange', 'onwebkitfullscreenerror',
      'part',
    ];
    const htmlElementGetSet = [
      'autocapitalize', 'autofocus', 'contentEditable', 'editContext', 'enterKeyHint', 'inert', 'innerText',
      'inputMode', 'onanimationend', 'onanimationiteration', 'onanimationstart', 'onbeforexrselect', 'oncommand',
      'oncontentvisibilityautostatechange', 'onmousewheel', 'onscrollsnapchange', 'onscrollsnapchanging',
      'onselectionchange', 'onselectstart', 'ontransitioncancel', 'ontransitionend', 'ontransitionrun',
      'ontransitionstart', 'outerText', 'popover', 'spellcheck', 'virtualKeyboardPolicy', 'writingSuggestions',
    ];

    // GETONLY:只读态,默认取保守值。
    const documentGetOnly = [
      ['activeViewTransition', () => null, chromeHost], // 实验面,WebView 无
      ['all', () => undefined],
      ['featurePolicy', () => null],
      ['fonts', () => null],
      ['fragmentDirective', () => null],
      ['pictureInPictureElement', () => null],
      ['pictureInPictureEnabled', () => false],
      ['pointerLockElement', () => null],
      ['prerendering', () => false],
      ['rootElement', () => null],
      ['scrollingElement', () => null],
      ['timeline', () => null],
      ['wasDiscarded', () => false],
      ['webkitCurrentFullScreenElement', () => null],
      ['webkitFullscreenElement', () => null],
      ['webkitFullscreenEnabled', () => false],
      ['webkitHidden', () => false],
      ['webkitIsFullScreen', () => false],
      ['webkitVisibilityState', () => 'visible'],
      ['xmlEncoding', () => null],
    ];
    const elementGetOnly = [
      ['currentCSSZoom', () => 1],
    ];
    const htmlElementGetOnly = [
      ['attributeStyleMap', () => null],
      ['isContentEditable', () => false],
    ];

    // ── 反射属性非 null 默认:reflectAccessor 分流 ──────────────────────────────
    // GETSET 经 eventHandler 统一默认 null;可写反射 IDL 属性真机默认非 null,分两类:
    //   crasher —— null 默认令页面 init 即抛(for...of/.trim() 于 null);cosmetic —— 不抛但值 tell。

    // part:per-instance 真实 DOMTokenList(经基座 makeTokenList)。缓存保 === 身份;每次 refresh 同步 attribute。
    const partLists = new WeakMap();
    const getPartList = (el) => {
      let list = partLists.get(el);
      if (!list) { list = makeTokenList(W, el, 'part'); if (list) partLists.set(el, list); }
      refreshTokenList(list);
      return list;
    };

    // innerText/outerText 默认取 textContent;cosmetic 对照 sdenv env/dom。
    const reflectDefaults = {
      // crasher:null 上正常使用即抛
      adoptedStyleSheets: () => [],
      innerText() { return this.textContent ?? ''; },
      outerText() { return this.textContent ?? ''; },
      part() { return getPartList(this); },
      // cosmetic:不抛但真机默认非 null
      designMode: () => 'off',
      domain: () => W.location?.hostname ?? '',
      contentEditable: () => 'inherit',
      spellcheck: () => true,
      autofocus: () => false,
      inert: () => false,
      fullscreenEnabled: () => true,
      autocapitalize: () => '',
      enterKeyHint: () => '',
      inputMode: () => '',
      alinkColor: () => '',
      bgColor: () => '',
      fgColor: () => '',
      linkColor: () => '',
      vlinkColor: () => '',
    };

    // readonly(writable=false → no-op set)。
    const reflectReadonly = new Set(['fullscreenEnabled']);

    // 自定义 setter:part [PutForwards=value],前向给 jsdom DTL 的 value setter(勿手 coerce)。
    const reflectSetter = {
      part(v) { getPartList(this).value = v; },
    };

    // crasher 子集:coerce 保型(innerText null→'' [LegacyNullToEmptyString];adoptedStyleSheets 非数组退空)。
    const reflectCoerce = {
      innerText: (v) => (v === null ? '' : String(v)),
      outerText: (v) => (v === null ? '' : String(v)),
      adoptedStyleSheets: (v) => (Array.isArray(v) ? v : adopt([])),
    };

    const installGetSet = (proto, names) => {
      for (const name of names) {
        if (hasOwn.call(proto, name)) continue;
        const getDefault = reflectDefaults[name];
        // 非 null 默认 + 回写。writable:自定义 setter > readonly no-op > WeakMap 存。
        const writable = reflectSetter[name] ?? !reflectReadonly.has(name);
        if (getDefault) reflectAccessor(proto, name, getDefault, writable, reflectCoerce[name]);
        else eventHandler(proto, name);                          // on* 等:默认 null(真机正确)
      }
    };
    const installGetOnly = (proto, table) => {
      for (const [name, getValue, gate] of table) {
        if (gate && !gate(traits)) continue;
        if (hasOwn.call(proto, name)) continue;
        accessor(proto, name, getValue);
      }
    };

    installGetSet(W.Document.prototype, documentGetSet);
    installGetSet(W.Element.prototype, elementGetSet);
    installGetSet(W.HTMLElement.prototype, htmlElementGetSet);
    installGetOnly(W.Document.prototype, documentGetOnly);
    installGetOnly(W.Element.prototype, elementGetOnly);
    installGetOnly(W.HTMLElement.prototype, htmlElementGetOnly);

    // Document 构造器静态方法:真机 ownNames 含 parseHTMLUnsafe(Chrome 124+, 含 WebView)。
    // prototype non-configurable → parseHTMLUnsafe 出现在 prototype 之后(键序 warn TELL,同 Node/Event 键序轴)。
    if (!W.Document.parseHTMLUnsafe) {
      Object.defineProperty(W.Document, 'parseHTMLUnsafe', {
        value: mask.native((html) => {
          // DOMParser 得完整 html/head/body;documentElement.innerHTML 会丢 head/body(.body=null)被识破。
          return new W.DOMParser().parseFromString(html == null ? '' : String(html), 'text/html');
        }, 'parseHTMLUnsafe', 1),
        writable: true, configurable: true, enumerable: false,
      });
    }
  },
};
