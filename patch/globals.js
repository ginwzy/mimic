/**
 * patch/globals —— 补 jsdom 缺失的 window 级标准方法 / 构造器(覆盖面工作)。
 * 对照 sdenv: browser/chrome/index.js 装配的 matchMedia / Worker / RTCPeerConnection 等。
 *
 * 分工:navigator 侧扩展归 patch/navigator;此处只管 window 全局函数与全局构造器壳。
 * 形态对齐真机基线(name/length/native/无 own toString/无 .prototype),由 mask.fn + dropOwnToString 落地。
 * 实现一律用箭头函数:普通/具名函数带 own .prototype(真机 native 方法无),箭头无 —— 消除该残留。
 * 行为多为可信壳(检测器主要看 typeof + toString + 形态);需要真实语义处就近实现。
 */

// 缺失 window 方法表:[名, arity, 实现, gate?]。arity = 真机基线 length(fn 校正,根因见 mask.fn)。
// gate(traits)→bool:平台差异方法的门控(缺省=全平台);谓词共享自 ./gates(见该文件:门控是一致性约束)。
import { chromeHost, desktopOnly } from './gates.js';

function methodTable(window, mask) {
  const W = window;
  const { pending, adopt } = mask; // window-realm Promise 壳(语义见 mask)
  return [
    ['fetch', 1, () => pending()],
    ['createImageBitmap', 1, () => pending()],
    // window.find:已废弃的页内查找,真机返回 boolean。
    ['find', 0, () => false],
    // reportError(e):真机把 e 作为 error 事件派发到 window;壳走 console.error 保留可观测性。
    ['reportError', 1, (e) => { try { W.console.error(e); } catch { /* noop */ } }],
    // structuredClone:桥接宿主实现(真深克隆),返回值对齐 window 身份。
    ['structuredClone', 1, (value, options) => adopt(globalThis.structuredClone(value, options))],
    // requestIdleCallback/cancelIdleCallback:jsdom 无,用宏任务近似(真机为 idle 阶段回调)。
    ['requestIdleCallback', 1, (cb) => W.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 1)],
    ['cancelIdleCallback', 1, (id) => W.clearTimeout(id)],
    // webkit* rAF:真机为 requestAnimationFrame 的历史别名,直接转发(保留真实节流语义)。
    ['webkitRequestAnimationFrame', 1, (cb) => W.requestAnimationFrame(cb)],
    ['webkitCancelAnimationFrame', 1, (id) => W.cancelAnimationFrame(id)],
    // webkitRequestFileSystem(type,size,success,error):已废弃的 FileSystem API,壳异步回错误回调。
    // [实测]桌面 Chrome 有、Android WebView 无(基线 resolved:false)→ desktop 门控。
    ['webkitRequestFileSystem', 3, (type, size, success, error) => {
      if (typeof error === 'function') W.setTimeout(() => error(new W.Error('SecurityError')), 1);
    }, desktopOnly],
    ['webkitResolveLocalFileSystemURL', 2, (url, success, error) => {
      if (typeof error === 'function') W.setTimeout(() => error(new W.Error('SecurityError')), 1);
    }, desktopOnly],
    // secure-context window 函数(corrected 基线经 secure 重采暴露,jsdom 全缺;length 皆 0)。均需 user
    // activation,壳取永久 pending(不 reject 触发 unhandledrejection)。
    //   getScreenDetails        Window Management:两 host 皆有 → 无门控。
    //   show{Directory,Open,Save}*Picker  File System Access:两 host 皆有 → 无门控。
    //   queryLocalFonts         Local Font Access:WebView 缺(基线 resolved:false)→ chromeHost 门控。
    ['getScreenDetails', 0, () => pending()],
    ['showDirectoryPicker', 0, () => pending()],
    ['showOpenFilePicker', 0, () => pending()],
    ['showSaveFilePicker', 0, () => pending()],
    ['queryLocalFonts', 0, () => pending(), chromeHost],
  ];
}

export default {
  name: 'globals',
  after: ['window'],
  apply({ window, mask, traits, profile }) {
    const { native, pending } = mask;
    const W = window;
    const ET = window.EventTarget.prototype; // 多数接口继承 EventTarget

    for (const [name, len, impl, gate] of methodTable(window, mask)) {
      if (gate && !gate(traits)) continue;              // 平台差异方法门控(据真机基线)
      if (typeof window[name] === 'function') continue; // jsdom 已提供则不覆盖
      window[name] = native(impl, name, len);
    }

    // 可 new 的接口类壳:mask.ctorIface 的薄封装,默认 parent=EventTarget.prototype(globals 这些接口真机
    // 多继承 EventTarget)。注:这些不在 harness probe 目标内(盲区),形态靠运行时自测,无真机基线对照。
    const makeCtor = (name, len, opts = {}) => mask.ctorIface(name, len, opts.init, { parent: ET, ...opts });

    // illegal-constructor 单例:类不可 new,但有一个全局实例(indexedDB / visualViewport)。取别名与 makeCtor 平行。
    const makeSingleton = mask.singleton;

    // Worker:postMessage/terminate;不真正加载脚本(壳),保留可 addEventListener。
    // length=1:真机 Worker(scriptURL, options?) 仅首参必选(jsdom 误为 2)。
    if (typeof W.Worker !== 'function') {
      makeCtor('Worker', 1, {
        init: (self) => { self.onmessage = null; self.onerror = null; self.onmessageerror = null; },
        methods: { postMessage: [1, () => undefined], terminate: [0, () => undefined] },
      });
    }

    // RTCPeerConnection:WebRTC 反检测重点(IP/媒体设备指纹)。给关键方法壳。
    if (typeof W.RTCPeerConnection !== 'function') {
      makeCtor('RTCPeerConnection', 0, {
        methods: {
          createOffer: [0, () => pending()], createAnswer: [0, () => pending()],
          setLocalDescription: [0, () => W.Promise.resolve()], setRemoteDescription: [1, () => W.Promise.resolve()],
          addIceCandidate: [0, () => W.Promise.resolve()], getStats: [0, () => W.Promise.resolve(mask.adopt(new W.Map()))],
          createDataChannel: [1, () => mask.adopt({})], createDTMFSender: [1, () => mask.adopt({})],
          addTrack: [1, () => mask.adopt({})], getSenders: [0, () => mask.adopt([])],
          getReceivers: [0, () => mask.adopt([])], getTransceivers: [0, () => mask.adopt([])],
          close: [0, () => undefined],
        },
        statics: { generateCertificate: [1, () => pending()] },
      });
    }

    // Notification:静态 permission/requestPermission(权限指纹)。
    if (typeof W.Notification !== 'function') {
      makeCtor('Notification', 1, {
        init: (self) => { self.onclick = null; self.onclose = null; self.onerror = null; self.onshow = null; },
        methods: { close: [0, () => undefined] },
        statics: { requestPermission: [1, () => W.Promise.resolve('default')] },
      });
      // 静态属性:permission(当前授权态)/ maxActions。
      Object.defineProperty(W.Notification, 'permission', {
        get: native(() => 'default', 'get permission'), enumerable: false, configurable: true,
      });
      Object.defineProperty(W.Notification, 'maxActions', {
        get: native(() => 2, 'get maxActions'), enumerable: false, configurable: true,
      });
    }

    // indexedDB:window.indexedDB 是 IDBFactory 单例(typeof object,非构造器)。
    if (W.indexedDB == null) {
      const idb = makeSingleton('IDBFactory', {
        methods: {
          open: [1, () => mask.adopt({})], deleteDatabase: [1, () => mask.adopt({})],
          databases: [0, () => W.Promise.resolve(mask.adopt([]))], cmp: [2, (a, b) => (a < b ? -1 : a > b ? 1 : 0)],
        },
      });
      Object.defineProperty(W, 'indexedDB', {
        get: native(() => idb, 'get indexedDB'), enumerable: true, configurable: true,
      });
    }

    // visualViewport:VisualViewport 单例,继承 EventTarget。尺寸自 profile.window 派生。
    if (W.visualViewport == null) {
      const win = profile.section('window');
      const vv = makeSingleton('VisualViewport', {
        parent: ET,
        accessors: {
          offsetLeft: () => 0, offsetTop: () => 0, pageLeft: () => 0, pageTop: () => 0,
          width: () => win.innerWidth ?? 0, height: () => win.innerHeight ?? 0, scale: () => 1,
        },
      });
      // onresize/onscroll 走原型可写 accessor(非实例 own data):真机在 VisualViewport.prototype、实例空。
      const vvProto = Object.getPrototypeOf(vv);
      mask.eventHandler(vvProto, 'onresize');
      mask.eventHandler(vvProto, 'onscroll');
      Object.defineProperty(W, 'visualViewport', {
        get: native(() => vv, 'get visualViewport'), enumerable: true, configurable: true,
      });
    }

    // matchMedia + MediaQueryList:真机 MediaQueryList.prototype → EventTarget.prototype(可 addEventListener)。
    if (typeof window.matchMedia !== 'function') {
      const mql = mask.iface('MediaQueryList');
      // iface 默认把 proto 顶到 window.Object.prototype;插入 EventTarget 层对齐真机原型链(顺带登记 brandless)。
      try { mask.eventTargetProto(mql.proto); } catch { /* noop */ }

      const coarse = traits.formFactor === 'mobile';
      const matchMedia = (query) => {
        const media = String(query == null ? '' : query);
        // 仅对触点能力做形态自洽判定(coarse/fine 随 formFactor);其余 query 保守返回 false。
        let matches = false;
        if (/\(\s*(any-)?pointer\s*:\s*coarse\s*\)/.test(media)) matches = coarse;
        else if (/\(\s*(any-)?pointer\s*:\s*fine\s*\)/.test(media)) matches = !coarse;
        return mql.create({ media, matches, onchange: null });
      };
      window.matchMedia = native(matchMedia, 'matchMedia', 1);
    }
  },
};
