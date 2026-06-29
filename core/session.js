/**
 * Session —— 在 Realm 之上的"跑目标脚本 → 捕获出口请求体"驱动层(对照 node_akamai 的 run-session/init)。
 *
 * 为什么:Realm 止于 create(建环境)+ run(求值)。Akamai/瑞数的最终产物(sensor_data / cookie)载于
 * 目标脚本**对外发起的请求体**里;run() 只返回 eval 值,够不到。且 POST 多由 load / DOMContentLoaded 事件
 * 异步触发,run() 同步段读不到 —— 必须装出口拦截 + 驱动事件循环 + 轮询,才把"目标脚本 → 产 payload"闭合。
 *
 * 拦截壳一律经 mask.hook(原地 native 化:toString 为 native code、保留 orig arity、不动构造器身份与 instanceof)。
 * 否则拦截层自身成新 tell —— 整体替换 window.XMLHttpRequest(参考 harness 的旧法)会令 send.toString 泄漏实现、
 * new XMLHttpRequest instanceof XMLHttpRequest 破。Session 仅在显式捕获时实例化,不影响 Realm / diff / smoke 路径。
 *
 * 边界:driveEvents 只做哑派发(派标准生命周期事件);可控 timer 队列 / load 后 setTimeout(0) 时序对齐 /
 * CookieJar 闭环与 cookie 基线断言属事件循环时序轴(另一项),本层只"用"事件循环、不精修其时序。
 */
import { Realm } from './realm.js';

const hostTag = (v) => Object.prototype.toString.call(v);

export class Session {
  /**
   * @param {object} [opts]  透传 Realm.create:{ profile, url, debug, trace, patches }
   *   url 覆写把文档域设成目标域 —— cookie 才按域落地、sensor 携带的 origin 才对(见 Realm.create 的 url 说明)。
   * @returns {Promise<Session>}
   */
  static async create({ profile, url, debug = false, trace = false, patches } = {}) {
    const realm = await Realm.create({ profile, url, debug, trace, patches });
    return new Session(realm);
  }

  constructor(realm) {
    this.realm = realm;
    this.posts = []; // 捕获的出口请求:{ via, tag, len, body }
    this._install();
  }

  /** 记一条出口请求体(host 侧)。body 为页面 realm 值(多为字符串;FormData/Blob 等仅记 String() 近似长度)。 */
  _record(via, body) {
    let len = 0;
    let text = null;
    try {
      if (body != null) {
        if (typeof body === 'string') { text = body; len = body.length; }
        else if (typeof body.byteLength === 'number') len = body.byteLength;       // ArrayBuffer / TypedArray
        else if (typeof body.length === 'number') len = body.length;               // 字符串类
        else { text = String(body); len = text.length; }                           // FormData/Blob 等:近似,非字节真长
      }
    } catch { /* 取长 / 转字符串失败不致命 */ }
    this.posts.push({ via, tag: hostTag(body), len, body: text });
  }

  /** 装出口拦截(XHR.send / fetch / navigator.sendBeacon),全经 mask.hook 保 native + 保 instanceof。 */
  _install() {
    const { window, mask } = this.realm;
    const rec = (via, body) => this._record(via, body);

    // XHR.send:捕获 body 后**不调 orig** —— jsdom 的 send 会尝试真实网络 I/O,而我们只要请求体;
    // 不发送则 onreadystatechange/onload 不 fire(对"抓首个非空 payload 即止"足够;需响应驱动的多 POST 见 issue 边界)。
    const xhrProto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (xhrProto) mask.hook(xhrProto, 'send', () => function send(body) { rec('xhr', body); });

    // fetch:捕获 init.body,回一个 window-realm 最小 resolved Response 壳(免页面 .then/.text() 链崩)。
    // 注:fetch(new Request(u,{body})) 把 body 挂 Request 而非 init → 此处漏(Akamai 走 XHR,当前足够;见 issue 边界)。
    if (typeof window.fetch === 'function') {
      mask.hook(window, 'fetch', () => function fetch(input, init) {
        rec('fetch', init && init.body);
        return window.Promise.resolve(mask.adopt({
          ok: true, status: 200, statusText: 'OK',
          text: mask.native(() => window.Promise.resolve(''), 'text', 0),
          json: mask.native(() => window.Promise.resolve(mask.adopt({})), 'json', 0),
          arrayBuffer: mask.native(() => window.Promise.resolve(mask.adopt(new window.ArrayBuffer(0))), 'arrayBuffer', 0),
        }));
      });
    }

    // navigator.sendBeacon:捕获 data,回 true(真机签名 boolean)。
    const navProto = window.Navigator && window.Navigator.prototype;
    if (navProto && typeof navProto.sendBeacon === 'function') {
      mask.hook(navProto, 'sendBeacon', () => function sendBeacon(url, data) { rec('beacon', data); return true; });
    }
  }

  /** 写入 cookie(逐条;jsdom 按文档域校验 —— 依赖 Realm 的 url 覆写把文档域设成目标域)。 */
  setCookies(cookies = []) {
    for (const c of cookies) this.realm.run('document.cookie = ' + JSON.stringify(c));
    return this;
  }

  /** 派标准生命周期事件,驱动 load / DOMContentLoaded 回调(BMS 的采集 + POST 多挂在此)。哑派发。 */
  driveEvents() {
    // readyState→'complete':经 Node 侧 mask.accessor 重定义 Document.prototype 上的原生访问器(jsdom 原生 readyState
    // 亦在此原型、仅值返回 loading/interactive)。保真形态(get name='get readyState'、native toString、无 set、
    // enumerable+configurable),消除此前页面 realm 裸 getter 的两处结构 tell:own-on-instance 位置错位
    //(document.hasOwnProperty('readyState') 真机为 false)+ getter 形态泄漏(.name==='get'、toString 暴露源码)。
    // 装在 driveEvents 段而非构造器:capture 先 run 目标脚本再 driveEvents,提前强制 'complete' 会改变脚本同步段对
    // readyState 的分支行为。
    const { window, mask } = this.realm;
    try { mask.accessor(window.Document.prototype, 'readyState', () => 'complete'); } catch { /* 不可重定义则跳过 */ }
    this.realm.run(`
      (function(){
        function fire(t, type){ try { t.dispatchEvent(new Event(type)); } catch(e){} }
        fire(document, 'readystatechange');
        fire(document, 'DOMContentLoaded');
        fire(window, 'DOMContentLoaded');
        fire(window, 'load');
        fire(window, 'pageshow');
      })();
    `);
    return this;
  }

  /** 首个非空请求体(= 最常见意义上的 payload);无则 null。 */
  get captured() {
    const hit = this.posts.find((p) => p.len > 0);
    return hit ? hit.body : null;
  }

  /**
   * 跑目标脚本 → (可选)驱动事件 → 轮询捕获,直到达 maxPosts 个非空请求体或超 deadline。
   * @param {string} code
   * @param {object} [opts]
   * @param {string}  [opts.scriptUrl]    目标脚本原始 URL(stack 帧来源;真机里每段脚本帧 URL = 其 src)
   * @param {number}  [opts.maxPosts=1]
   * @param {number}  [opts.deadlineMs=15000]
   * @param {boolean} [opts.driveEvents=true]
   * @param {number}  [opts.pollMs=100]
   * @returns {Promise<{ok,runError,syncCaptured,captured,posts,jsdomErrors,missing}>}
   */
  async capture(code, { scriptUrl, maxPosts = 1, deadlineMs = 15000, driveEvents = true, pollMs = 100 } = {}) {
    const runRes = this.realm.run(code, { url: scriptUrl });
    const syncCaptured = this.captured != null; // POST 是否落在 run 同步段内(否则需事件触发)
    if (driveEvents) this.driveEvents();

    const nonEmpty = () => this.posts.filter((p) => p.len > 0).length;
    const start = Date.now();
    while (Date.now() - start < deadlineMs && nonEmpty() < maxPosts) {
      await new Promise((r) => setTimeout(r, pollMs));
    }

    return {
      ok: runRes.ok,
      runError: runRes.ok ? null : runRes.error,
      syncCaptured,
      captured: this.captured,
      posts: this.posts.slice(),
      jsdomErrors: this.realm.jsdomErrors.length,
      missing: runRes.missing || [],
    };
  }

  describe() { return this.realm.describe(); }

  dispose() { this.realm.dispose(); }
}
