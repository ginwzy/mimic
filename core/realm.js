/**
 * Realm —— 一套完整的浏览器全局世界 + 一次脚本执行。
 * 生命周期:create(建 jsdom + 装配 patch) → run(执行) → dispose(销毁)。
 */
import vm from 'node:vm';
import { createWindow } from '../base/jsdom.js';
import { createMask } from '../mask/index.js';
import { Profile } from './profile.js';
import { runPipeline } from './pipeline.js';
import { patches as defaultPatches } from '../patch/index.js';
import { Detector } from '../trace/detector.js';

export class Realm {
  constructor({ window, context, profile, mask, traits, trace, url, jsdomErrors }) {
    this.window = window;
    this.context = context; // window 的 vm context,供 run() 用 vm.runInContext 执行
    this.profile = profile;
    this.mask = mask;
    this.traits = traits;
    this.trace = trace || null;
    this.url = url || null; // 文档当前 URL(jsdom 归一化);run() 的 stack filename 默认回退到它
    this.jsdomErrors = jsdomErrors || []; // 定时器/事件回调里的未捕获异步错误(裸 VirtualConsole 本会静默吞)
    this.decisions = [];
  }

  /**
   * @param {object} [opts]
   * @param {string|object|Profile} [opts.profile]
   * @param {boolean} [opts.trace]
   * @param {Array}   [opts.patches]
   * @param {string}  [opts.url]  运行期文档 URL 覆写(目标站点域);省略则取 profile.location.href,再省略兜底 example.com。
   *   跑真实目标时必传 —— 文档域正确,cookie 才按域落地、sensor 携带的 origin/referrer 才对。
   * @param {boolean} [opts.debug] 调试期把 jsdom 异步错误转发到宿主 stderr(默认静音;不改页面可见 error 行为)。
   * @returns {Promise<Realm>}
   */
  static async create({ profile, trace = false, patches = defaultPatches, url, debug = false } = {}) {
    const prof = await Profile.load(profile);
    const problems = prof.validate();
    if (problems.length) console.warn(`[profile:${prof.name}] 指纹自洽性警告:\n  - ${problems.join('\n  - ')}`);

    // 文档 URL 单一真相源:运行期 url > profile.location.href > createWindow 的 example.com 兜底。
    // jsdom 由该 URL 自动派生 location.origin/protocol/host/...,故不在 profile 冗余存这些(防 href↔origin 矛盾)。
    let realm; // onError 闭包在异步错误时(run 之后)读 realm.trace,故先声明、构造后赋值。
    const { window, context, errors } = createWindow({
      url: url || prof.get('location.href'),
      debug,
      // trace 开启时把异步 jsdomError 也喂 detector → 计入 missing()(否则只有 run() 的同步错误被捕获)。
      onError: (e) => realm?.trace?.captureError?.(e?.detail ?? e),
    });
    const mask = createMask(window);
    mask.boot();

    realm = new Realm({
      window,
      context,
      profile: prof,
      mask,
      traits: prof.traits(),
      trace: trace ? new Detector(window) : null,
      url: window.location.href, // 归一化后的规范 URL(始终有值:兜底 example.com)
      jsdomErrors: errors,
    });

    // 装配失败不留活 window:create 已建 jsdom window,runPipeline 抛出(结构性循环依赖 / applies 谓词抛错 /
    // patch 致命错)时,这个 window 无人 close 会泄漏(池化/长跑显形)。close 后重抛 —— 错误仍 loud 冒泡,资源已清。
    // 注:单 patch apply 内部抛错由 pipeline best-effort 吞并告警(见 pipeline),不会到这里;到这里的是应中止整个
    // realm 构造的结构性/谓词级失败。
    try {
      realm.decisions = runPipeline(patches, realm);
    } catch (e) {
      try { window.close?.(); } catch { /* noop */ }
      throw e;
    }
    return realm;
  }

  /**
   * 执行代码,返回结构化结果。
   * 用 vm.runInContext(而非 window.eval)在 window 的 vm context 内执行:经 filename 把 error.stack 帧来源
   * 对齐为页面 URL,配合 patch/stack 的 prepareStackTrace 剥离宿主帧,消除执行环境泄漏。
   * @param {string} code
   * @param {object} [opts]
   * @param {string} [opts.url]  该脚本在 stack 帧中显示的来源 URL;默认回退到文档 URL(this.url)。
   *   真机里每段脚本的 stack 帧 URL 是其真实 src,故执行抓取的目标脚本时应传入其原始 URL。
   */
  run(code, { url } = {}) {
    // vm.runInContext 的 options.filename 只接 string|undefined,绝不接 null —— 默认值仅对 undefined 生效。
    // 直接 new Realm 不传 url 时 this.url 为 null,这里收口成 undefined,让 vm 退回默认 filename 而非抛错。
    const filename = url || this.url || undefined;
    try {
      const value = vm.runInContext(code, this.context, { filename });
      return { ok: true, value, missing: this.trace?.missing() ?? [] };
    } catch (e) {
      this.trace?.captureError?.(e);
      return { ok: false, error: e.message, stack: e.stack, missing: this.trace?.missing() ?? [] };
    }
  }

  /** 内省:此环境由哪些 patch 组成 / 跳过及原因。 */
  describe() {
    return {
      profile: this.profile.name,
      traits: this.traits,
      patches: this.decisions,
    };
  }

  /**
   * 销毁:close jsdom window 并断开本 Realm 对 window 对象图的全部引用。仅置空 this.window 不够 —— context
   * 实测 === window(run() 走 this.context 仍能跑),mask/trace 也闭包持有 window;池化/缓存 Realm 时这些会累积
   * 钉住整张 window 图。故 context/mask/trace/profile 一并置 null,使"已销毁 Realm 不再钉住 window"成真不变量:
   * dispose 后再 run()/describe() 即抛(更严的"勿在销毁后使用"契约;仓内无此类调用点)。二次 dispose 幂等(?. 守卫)。
   */
  dispose() {
    try {
      this.window?.close?.();
    } catch {
      /* noop */
    }
    this.window = null;
    this.context = null;
    this.mask = null;
    this.trace = null;
    this.profile = null;
  }
}
