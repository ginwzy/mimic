/**
 * Profile —— 声明式指纹配置。一个 JSON = 一个浏览器身份。
 *
 * 两项扩展:
 *  - extends:  meta.extends 指向父 profile,继承其结构层(DRY)。
 *  - traits:   meta.traits 声明环境特征(platform/formFactor/host/...),
 *              是真实采集的"投影",供 patch 门控;validate() 校验它与数据自洽。
 *
 * 继承边界(防指纹嵌合):身份段整段来自子(单次采集),不跨层深合并;
 * 其余段深合并以复用父的结构默认。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROFILES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../profiles');

// 身份段:合并时整段替换,绝不与父拼装(canvas+另一机 UA = 自相矛盾)。
const IDENTITY = new Set(['canvas', 'webgl', 'audio', 'fonts']);

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** 深合并:对象递归,数组/标量替换;身份段整段替换。 */
function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (IDENTITY.has(k) || !isObj(base[k]) || !isObj(over[k])) out[k] = over[k];
    else out[k] = merge(base[k], over[k]);
  }
  return out;
}

export class Profile {
  constructor(data = {}) {
    this.data = data;
  }

  /**
   * @param {string|object|Profile} source 名称 / 配置对象 / 已有 Profile
   * @returns {Promise<Profile>}
   */
  static async load(source, seen = new Set()) {
    if (source instanceof Profile) return source;
    if (isObj(source)) return new Profile(source);
    if (typeof source !== 'string') return new Profile({});

    if (seen.has(source)) throw new Error(`profile 循环继承: ${source}`);
    seen.add(source);

    const file = path.join(PROFILES_DIR, `${source}.json`);
    let data = JSON.parse(await fs.promises.readFile(file, 'utf-8'));
    const parent = data.meta?.extends;
    if (parent) {
      const base = await Profile.load(parent, seen);
      data = merge(base.data, data);
    }
    return new Profile(data);
  }

  /** 列出可用 profile(排除 _ 开头的基底)。 */
  static async list() {
    const walk = async (dir, prefix = '') => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
      const out = [];
      for (const e of entries) {
        if (e.name.startsWith('_')) continue;
        if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), `${prefix}${e.name}/`)));
        else if (e.name.endsWith('.json')) out.push(prefix + e.name.replace(/\.json$/, ''));
      }
      return out;
    };
    return walk(PROFILES_DIR);
  }

  section(name) {
    return this.data[name] || {};
  }

  get(pathStr, fallback) {
    let cur = this.data;
    for (const key of pathStr.split('.')) {
      if (cur == null) return fallback;
      cur = cur[key];
    }
    return cur === undefined ? fallback : cur;
  }

  get name() {
    return this.data.meta?.name || 'anonymous';
  }

  /** 环境特征(供 patch 门控)。 */
  traits() {
    return this.data.meta?.traits || {};
  }

  /**
   * 校验 traits 与采集数据自洽,返回问题列表(空 = 通过)。
   * 守住"声明的特征 ⊂ 数据所蕴含的",防止架构层重新引入指纹矛盾。
   */
  validate() {
    const t = this.traits();
    const ua = this.get('navigator.userAgent', '');
    const platform = this.get('navigator.platform', '');
    const problems = [];
    const want = (cond, msg) => { if (!cond) problems.push(msg); };

    if (t.host === 'webview') want(/\bwv\b/.test(ua), 'host=webview 但 UA 不含 wv');
    if (t.host === 'chrome') want(!/\bwv\b/.test(ua), 'host=chrome 但 UA 含 wv');
    if (t.platform === 'android') want(/Android/.test(ua), 'platform=android 但 UA 不含 Android');
    if (t.platform === 'windows') want(platform === 'Win32', 'platform=windows 但 navigator.platform≠Win32');
    if (t.platform === 'macos') want(platform === 'MacIntel', 'platform=macos 但 navigator.platform≠MacIntel');
    if (t.formFactor === 'mobile') want(/Mobile/.test(ua), 'formFactor=mobile 但 UA 不含 Mobile');
    if (t.formFactor === 'desktop') want(!/Mobile/.test(ua), 'formFactor=desktop 但 UA 含 Mobile');

    return problems;
  }
}
