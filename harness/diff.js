/**
 * harness/diff.js —— 纯结构 diff 引擎(无 I/O)。
 *
 * diff(baseline, mimic) → DiffEntry[]:逐 target、逐 key、逐字段比对,每条归三桶之一:
 *   TELL    两侧都有此键、但形态不同 —— 真正可被检测器识破的"谎言"(name/length/native/描述符/原型链/类型错配)。唯一默认 fatal 的桶。
 *   MISSING baseline 有、mimic 无 —— jsdom 天生缺几百个 API(yvq.6),预期内的覆盖缺口,永不致 gate 失败。
 *   EXTRA   mimic 有、baseline 无 —— 沙箱构件/过度补丁,真 Chrome 没有(可能是泄漏正信号)。仅在基线 complete 时判定。
 *   INFO    两侧相等或仅良性值差。默认隐藏。
 *
 * 这套三桶分类是 harness 的灵魂:把"jsdom 天生贫瘠"(MISSING)与"有这键但形态错"(TELL)分开,
 * 避免一墙红噪声淹没真正该修的 tell —— 正是 .13 立项动机。
 *
 * 部分基线(meta.complete=false 或字段缺省):只比对基线显式给出的 target/key/字段,
 * 不据其键集合反推 MISSING/EXTRA。字段级亦然(fn 块只列已知字段则只比已知字段)。
 */
import { classify } from './whitelist.js';

// 字段 → 默认 severity(对照设计 diffFields 表)。
const FATAL = new Set([
  'protoChain', 'tag', 'key.type',
  'flags.enumerable',
  'fn.name', 'fn.length', 'fn.toStringNative', 'fn.hasOwnToString',
]);
// EXTRA 里属"沙箱泄漏"的字段 → fatal(target/键真 Chrome 没有);symbolKey 留 warn,由 yvq.2 白名单兜。
const EXTRA_FATAL = new Set(['resolved', 'key']);
function severityOf(field, bucket) {
  if (bucket === 'INFO') return 'info';
  if (bucket === 'MISSING') return 'warn';
  if (bucket === 'EXTRA') return EXTRA_FATAL.has(field) ? 'fatal' : 'warn';
  return FATAL.has(field) ? 'fatal' : 'warn';
}

function entry(target, key, field, bucket, baseline, mimic) {
  const e = { targetId: target.id, t1: !!target.t1, key: key || null, field, bucket, baseline, mimic };
  e.severity = severityOf(field, bucket);
  e.whitelist = classify(e);
  return e;
}

/** 比对两个 fnTell;prefix 区分 'fn'/'accessor.get'/'accessor.set'。只比基线已定义的字段(字段级部分基线)。 */
function diffFn(target, key, prefix, base, mim, out) {
  const isAccessorHalf = prefix.indexOf('accessor.') === 0;
  if (!base) return; // 基线无此(半)访问器/函数;mimic 若有 → 由对象层 EXTRA 覆盖,不在此重复判定。
  if (!mim) {
    // 基线有、mimic 无:访问器半边缺失=属性存在但 getter/setter 没了,可被检测器识破 → TELL;
    // 整函数 target 缺失才是 jsdom 覆盖缺口 → MISSING(由 yvq.6 白名单吞)。
    if (isAccessorHalf) out.push(entry(target, key, `${prefix}.exists`, 'TELL', 'present', 'absent'));
    else out.push(entry(target, key, prefix, 'MISSING', base, undefined));
    return;
  }
  const FIELDS = ['name', 'length', 'toStringNative', 'hasOwnToString', 'hasPrototype', 'ownNames'];
  for (const f of FIELDS) {
    if (base[f] === undefined) continue;            // 基线未给该字段 → 跳过
    if (base[f] !== mim[f]) out.push(entry(target, key, `${prefix}.${f}`, 'TELL', base[f], mim[f]));
  }
  // 源码片段仅信息性(两侧非 native 时人眼定位用)。
  if (base.toStringSrc !== undefined && base.toStringSrc !== mim.toStringSrc) {
    out.push(entry(target, key, `${prefix}.toStringSrc`, 'INFO', base.toStringSrc, mim.toStringSrc));
  }
}

/** 比对一个 KeyRecord。 */
function diffKey(target, key, base, mim, out) {
  if (base.type !== undefined && mim.type !== undefined && base.type !== mim.type) {
    out.push(entry(target, key, 'key.type', 'TELL', base.type, mim.type));
    return; // 类型都错了,深比无意义
  }
  if (base.flags && mim.flags) {
    for (const f of ['writable', 'enumerable', 'configurable']) {
      if (base.flags[f] === undefined) continue;
      if (base.flags[f] !== mim.flags[f]) out.push(entry(target, key, `flags.${f}`, 'TELL', base.flags[f], mim.flags[f]));
    }
  }
  if (base.valueType !== undefined && mim.valueType !== undefined && base.valueType !== mim.valueType) {
    out.push(entry(target, key, 'valueType', 'TELL', base.valueType, mim.valueType));
  }
  if (base.fn) diffFn(target, key, 'fn', base.fn, mim.fn, out);
  if (base.accessor) {
    diffFn(target, key, 'accessor.get', base.accessor.get, mim.accessor && mim.accessor.get, out);
    diffFn(target, key, 'accessor.set', base.accessor.set, mim.accessor && mim.accessor.set, out);
  }
}

function arrEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 比对一个 object target。complete 决定是否判定 EXTRA / ownKeys 顺序。 */
function diffObject(target, base, mim, complete, out) {
  if (base.tag !== undefined && mim.tag !== undefined && base.tag !== mim.tag) {
    out.push(entry(target, null, 'tag', 'TELL', base.tag, mim.tag));
  }
  if (base.protoChain && mim.protoChain && !arrEq(base.protoChain, mim.protoChain)) {
    out.push(entry(target, null, 'protoChain', 'TELL', base.protoChain.join(' → '), mim.protoChain.join(' → ')));
  }
  const bKeys = base.keys || {};
  const mKeys = mim.keys || {};
  for (const k of Object.keys(bKeys)) {
    if (!(k in mKeys)) { out.push(entry(target, k, 'key', 'MISSING', 'present', 'absent')); continue; }
    diffKey(target, k, bKeys[k], mKeys[k], out);
  }
  if (complete) {
    for (const k of Object.keys(mKeys)) {
      if (!(k in bKeys)) out.push(entry(target, k, 'key', 'EXTRA', 'absent', 'present'));
    }
    if (base.ownKeys && mim.ownKeys && !arrEq(base.ownKeys, mim.ownKeys)) {
      // 同集合不同序才算 tell;集合差异已由上面的 MISSING/EXTRA 覆盖。
      const sameSet = base.ownKeys.length === mim.ownKeys.length &&
        base.ownKeys.every((k) => mim.ownKeys.includes(k));
      if (sameSet) out.push(entry(target, null, 'ownKeys.order', 'TELL', base.ownKeys.join(','), mim.ownKeys.join(',')));
    }
    // symbol 泄漏:mimic 多出的 symbol 键(yvq.2)。
    const bSym = base.symbolKeys || [];
    const mSym = mim.symbolKeys || [];
    for (const s of mSym) if (!bSym.includes(s)) out.push(entry(target, s, 'symbolKey', 'EXTRA', 'absent', 'present'));
  }
}

/**
 * @param {object} baseline  真机/种子基线快照
 * @param {object} mimic     mimic realm 快照
 * @returns {Array} DiffEntry[]
 */
export function diff(baseline, mimic) {
  const out = [];
  const metaComplete = baseline.meta ? baseline.meta.complete !== false : true;
  const mById = new Map((mimic.targets || []).map((t) => [t.id, t]));

  for (const bt of baseline.targets || []) {
    const mt = mById.get(bt.id);
    const complete = bt.complete !== undefined ? bt.complete : metaComplete;

    if (bt.resolved === false) {
      // 基线声明此 target 在真机不存在 → mimic 若有即 EXTRA(仅 complete 时)。
      if (complete && mt && mt.resolved) out.push(entry(bt, null, 'resolved', 'EXTRA', false, true));
      continue;
    }
    if (!mt || mt.resolved === false) {
      out.push(entry(bt, null, 'resolved', 'MISSING', true, mt ? false : 'absent'));
      continue;
    }
    if (bt.category === 'function') diffFn(bt, null, 'fn', bt.fn, mt.fn, out);
    else diffObject(bt, bt, mt, complete, out);
  }
  return out;
}

/**
 * 汇总 + gate 判定。
 * @param {Array} entries
 * @param {object} [opts]
 * @param {boolean} [opts.t1Only]  仅就 T1 已修目标判 gate(.13 验收口径)
 */
export function summarize(entries, { t1Only = false } = {}) {
  const scope = t1Only ? entries.filter((e) => e.t1) : entries;
  const counts = { TELL: 0, MISSING: 0, EXTRA: 0, INFO: 0 };
  let whitelisted = 0;
  const blockers = [];
  for (const e of scope) {
    counts[e.bucket] = (counts[e.bucket] || 0) + 1;
    if (e.whitelist) { whitelisted++; continue; }
    // gate:未白名单的 TELL,或被标 fatal 的 EXTRA,阻断。MISSING 永不阻断。
    if (e.bucket === 'TELL' || (e.bucket === 'EXTRA' && e.severity === 'fatal')) blockers.push(e);
  }
  return {
    scope: t1Only ? 't1' : 'all',
    counts,
    whitelisted,
    blockers,
    gatePass: blockers.length === 0,
  };
}
