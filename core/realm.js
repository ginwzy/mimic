/**
 * Realm —— 一套完整的浏览器全局世界 + 一次脚本执行。
 * 生命周期:create(建 jsdom + 装配 patch) → run(执行) → dispose(销毁)。
 */
import { createWindow } from '../base/jsdom.js';
import { createMask } from '../mask/index.js';
import { Profile } from './profile.js';
import { runPipeline } from './pipeline.js';
import { patches as defaultPatches } from '../patch/index.js';
import { Detector } from '../trace/detector.js';

export class Realm {
  constructor({ window, profile, mask, traits, trace }) {
    this.window = window;
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

    const window = createWindow({ url: prof.get('location.href') });
    const mask = createMask(window);
    mask.boot();

    const realm = new Realm({
      window,
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
   * @param {string} code
   */
  run(code) {
    try {
      const value = this.window.eval(code);
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
