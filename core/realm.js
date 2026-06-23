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
  constructor({ window, context, profile, mask, traits, trace }) {
    this.window = window;
    this.context = context; // window 的 vm context,供 run() 用 vm.runInContext 执行
    this.profile = profile;
    this.mask = mask;
    this.traits = traits;
    this.trace = trace || null;
    this.decisions = [];
  }

  /**
   * @param {object} [opts]
   * @param {string|object|Profile} [opts.profile]
   * @param {boolean} [opts.trace]
   * @param {Array}   [opts.patches]
   * @returns {Promise<Realm>}
   */
  static async create({ profile, trace = false, patches = defaultPatches } = {}) {
    const prof = await Profile.load(profile);
    const problems = prof.validate();
    if (problems.length) console.warn(`[profile:${prof.name}] 指纹自洽性警告:\n  - ${problems.join('\n  - ')}`);

    const { window, context } = createWindow({ url: prof.get('location.href') });
    const mask = createMask(window);
    mask.boot();

    const realm = new Realm({
      window,
      context,
      profile: prof,
      mask,
      traits: prof.traits(),
      trace: trace ? new Detector(window) : null,
    });

    realm.decisions = runPipeline(patches, realm);
    return realm;
  }

  /**
   * 执行代码,返回结构化结果。
   * 用 vm.runInContext(而非 window.eval)在 window 的 vm context 内执行:经 filename 把 error.stack 帧来源
   * 对齐为页面 URL,配合 patch/stack 的 prepareStackTrace 剥离宿主帧,消除执行环境泄漏(yvq.3)。
   * @param {string} code
   * @param {object} [opts]
   * @param {string} [opts.url]  该脚本在 stack 帧中显示的来源 URL;默认回退到 document URL(location.href)。
   *   真机里每段脚本的 stack 帧 URL 是其真实 src,故执行抓取的目标脚本时应传入其原始 URL。
   */
  run(code, { url } = {}) {
    const filename = url || this.profile.get('location.href');
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

  dispose() {
    try {
      this.window.close?.();
    } catch {
      /* noop */
    }
    this.window = null;
  }
}
