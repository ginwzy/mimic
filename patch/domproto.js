/**
 * patch/domproto —— 补 jsdom 缺失的 DOM 原型**成员**(方法 + 访问器)于 Document/Element/HTMLElement/
 * EventTarget.prototype。边界:globals 管 window 全局函数 + 全局构造器,navigator 管 Navigator.prototype;
 * 此处只管 DOM 元素 / 文档 / 事件原型上的成员。native 化与形态契约见 mask 头注 + globals(只写一次):
 * mask.method 装 native data 方法、mask.eventHandler 装 get+set 访问器、mask.accessor 装 get-only 访问器,
 * 三者形态(name/length/native/无 own toString/无 .prototype、flags)均逐字段对齐真机基线。
 * 实现一律箭头(无 .prototype,真机 native 亦无)。返回值/默认值保真非本切片目标 —— L1 diff 只验形态,
 * 行为取安全默认(getAnimations→[]、checkVisibility→true、Promise 类取永久 pending、on* 默认 null、只读态
 * 取保守值);this 依赖的真实语义(getHTML 序列化 / scroll 实际滚动 / 反射属性回写 attribute)留后续。
 * 例外:可写反射属性的 null 默认有两类问题 —— 一类页面正常使用即**抛**(crasher),一类不抛但默认值失真
 * (cosmetic 值 tell);二者均经 mask.reflectAccessor 取非 null 正确默认 —— 见下方反射默认值块(策略只在该处讲全)。
 *
 * ownKeys.order 与切片边界:L1 diff 的 order tell 仅在两侧键集**相等**时触发(见 diff.js sameSet)。补成员
 * 令对应原型键集补全 → 激活 order 检测 → 须在 keyorder 注册真机序。本 patch 补全 EventTarget.prototype
 * (仅缺 when)及 Document/Element/HTMLElement.prototype(方法 + 访问器全补)→ keyorder 据真机基线为这些
 * 原型注册序。order 随 host 而异者(事件处理器密集原型 chrome-vs-webview 序不同)由 keyorder per-host 表承接。
 *
 * arity / 门控:arity = 真机基线 fn.length(authoring 时提取,勿据签名臆测:caretRangeFromPoint=0、scroll/
 * fullscreen 族=0)。host 门控(chromeHost):browsingTopics/hasPrivateToken/hasRedemptionRecord/ariaNotify
 * (方法)+ activeViewTransition(访问器)是 Chrome 隐私 / 实验面,WebView 基线无 —— 无门控即 webview 侧 EXTRA。
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
    // 每个 impl 必须是**独立**函数对象:mask.fn 原地改写 name/length,共享一个引用会令后注册的方法
    // 覆盖前者的 name/length(全指向同一被改写对象)。故下方一律内联新箭头,勿抽公共 const 复用。

    // [名, arity, 实现, gate?]。
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

    // EventTarget.prototype.when:Observable(新标准)。补它令 ET 键集补全 → keyorder 重排其真机序(配套)。
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
    // GETSET:get+set 形态(get 'get X'/len0、set 'set X'/len1)。涵盖 on* 事件处理器**与**可写反射 IDL
    // 属性(designMode/contentEditable/aria*Element 等,真机同此形态)。经 mask.eventHandler:每键独立闭包
    // 存值,默认 null(on* 正确;反射属性语义默认留后续)。名单据真机基线 accessor.get+set 判定(authoring 提取)。
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

    // GETONLY:[名, 默认值 getter, gate?]。只读态(元素引用/能力位/可见态),默认取保守值(经 mask.accessor,
    // get-only、'get X'/len0)。getValue 由 mask.accessor 在取值时调 + adopt 对齐 window 身份。
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
    // 上面 GETSET 名单经 eventHandler 统一默认 null;对 ~80 个 on* 处理器 null 正确,但可写反射 IDL 属性真机
    // 默认是具体类型值。两类需分流到 mask.reflectAccessor(形态同 eventHandler,仅默认值改正确类型):
    //   crasher —— null 默认会在页面 init 正常使用时**抛**(for...of/.trim()/.add()/.length 于 null),在
    //     sensor 运行前中断执行(被 base/jsdom 裸 VirtualConsole 静默吞放大)。adoptedStyleSheets/innerText/
    //     outerText/part 属此。
    //   cosmetic —— 不抛但 null 是**值 tell**(真机 designMode 'off'、spellcheck true、域色属性 '' …)。
    // 键名在 Document/Element/HTMLElement 原型上唯一,故按名匹配即可,无需区分 host 原型。

    // part 默认值:per-instance **真实** DOMTokenList(经基座 makeTokenList 复用 jsdom classList 的同一工厂,绑
    // part attribute)。真实 DTL 自带空 own 属性 + 方法在 DOMTokenList.prototype + 真 token 集 + attribute 双向
    // 联动 + per-instance 身份 —— 取代旧单例壳(单例 tell + 10 个 own 方法 tell + 无真实 token,皆已删)。
    // 缓存保 per-instance 身份(el.part === el.part);每次访问前 refresh,使外部 setAttribute('part') 后读到最新
    // (jsdom 仅 class 有 setAttribute→attrModified 钩子,part 无)。
    const partLists = new WeakMap();
    const getPartList = (el) => {
      let list = partLists.get(el);
      if (!list) { list = makeTokenList(W, el, 'part'); if (list) partLists.set(el, list); }
      refreshTokenList(list);
      return list;
    };

    // getDefault 以 this=实例 调用(reflectAccessor 的 getter 经 get-syntax 取得,可绑 this 且无 .prototype):
    // innerText/outerText 默认取实例 textContent;其余不依赖实例,用箭头。
    // cosmetic 默认值对照 sdenv env/dom(document.js designMode/domain、elements.js spellcheck/contentEditable/…)。
    // 回写:reflectAccessor 默认 per-instance WeakMap 存写值 → 赋值 round-trip(详见 mask 头注)。
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

    // 真机 readonly(保留 no-op set,见 mask.reflectAccessor 头注 writable=false):赋值静默忽略、读回不变。
    const reflectReadonly = new Set(['fullscreenEnabled']);

    // 自定义 setter(writable=函数):part 是 [PutForwards=value] —— el.part = v 实为 el.part.value = v。
    // 前向给 jsdom 真实 DTL 的 value setter(DOMString 转换 null→'null' / Symbol→抛 由其负责,逐字匹配真机,
    // 勿手 coerce)。这是 part round-trip 的真实现(经 attribute 落地、读回仍是 token 列表)。
    const reflectSetter = {
      part(v) { getPartList(this).value = v; },
    };

    // 有类型契约的 writable crasher 子集:存前 coerce 保型,否则 el.innerText=null / adoptedStyleSheets=null 等
    // 不兼容值入存,用时 .trim()/for...of 即崩(复活 crasher,被裸 VirtualConsole 静默吞)。innerText/outerText
    // 的 null→'' 正合真机 [LegacyNullToEmptyString];非数组 adoptedStyleSheets 退默认空数组(读回仍可迭代)。
    // 兜底 adopt([]) 对齐 sandbox realm(getter 对存值分支裸返不 adopt,故 host-realm 数组须在此就地 adopt)。
    const reflectCoerce = {
      innerText: (v) => (v === null ? '' : String(v)),
      outerText: (v) => (v === null ? '' : String(v)),
      adoptedStyleSheets: (v) => (Array.isArray(v) ? v : adopt([])),
    };

    const installGetSet = (proto, names) => {
      for (const name of names) {
        if (hasOwn.call(proto, name)) continue;
        const getDefault = reflectDefaults[name];
        // 非 null 默认 + 回写。writable:自定义 setter(part PutForwards)> 函数;readonly 保 no-op;余 WeakMap 存。
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
  },
};
