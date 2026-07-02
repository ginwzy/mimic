/**
 * harness/index.js —— L1 diff harness 编程 API + 报告格式化。
 *
 * runDiff:载入真机/种子基线 → mimic 跑同套 probe → diff → summarize → 报告对象。
 * CLI 与测试都走这一个入口。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotMimic } from './mimic-snapshot.js';
import { diff, summarize } from './diff.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASELINES_DIR = path.join(HERE, 'baselines');
const PROFILES_DIR = path.resolve(HERE, '../profiles');

// profile→baseline 里"名不同"的人工对(diff-gate.test.js 的 PAIRS 另各自钉死作回归防护,故不共享)。
const PROFILE_BASELINE = {
  'chrome-mac': 'macos-chrome-v148', // demo profile 无同名基线,host/formFactor 同 v148
};

/** profile 的配对基线名:显式映射 → 同名 → 唯一 `profile-*` 前缀(linux-chrome→…-v143)。无解返回 null,多解抛(逼 --baseline)。 */
function pairedBaseline(profile) {
  if (PROFILE_BASELINE[profile]) return PROFILE_BASELINE[profile];
  const all = listBaselines();
  if (all.includes(profile)) return profile;
  const pref = all.filter((b) => b.startsWith(`${profile}-`));
  if (pref.length === 1) return pref[0];
  if (pref.length > 1) throw new Error(`profile "${profile}" 有多个候选基线 [${pref.join(', ')}],请 --baseline 指定`);
  return null;
}

/**
 * 解析 baseline:路径直用;裸名→baselines/<name>.json;省 baseline 但有 profile → 反查配对基线
 * (不回落字母序第一,否则桌面 profile 套 mobile 基线产 host 错配假 EXTRA/MISSING);皆省 → 首个基线。
 */
function resolveBaseline(ref, profile) {
  if (ref) {
    if (ref.endsWith('.json') || ref.includes('/')) return path.resolve(ref);
    return path.join(BASELINES_DIR, `${ref}.json`);
  }
  if (profile) {
    const paired = pairedBaseline(profile);
    if (paired) return path.join(BASELINES_DIR, `${paired}.json`);
    throw new Error(`profile "${profile}" 无配对基线;用 --baseline <name> 指定(可用:${listBaselines().join(', ')})`);
  }
  const found = listBaselines();
  if (!found.length) throw new Error('无可用基线:先用 `mimic baseline` 采一份真机基线到 harness/baselines/');
  return path.join(BASELINES_DIR, `${found[0]}.json`);
}

export function listBaselines() {
  try {
    return readdirSync(BASELINES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.profile]   mimic profile(默认取基线 meta.profile)
 * @param {string} [opts.baseline]  基线名/路径(省略取 baselines/ 下第一个)
 * @param {boolean} [opts.t1Only]   仅就 T1 已修目标判 gate
 * @returns {Promise<{profile,baseline,entries,summary}>}
 */
export async function runDiff({ profile, baseline, t1Only = false } = {}) {
  const file = resolveBaseline(baseline, profile);
  const base = JSON.parse(readFileSync(file, 'utf8'));
  // 配对默认:统一采集服务同名落 profiles/<name>.json 与 baselines/<name>.json,故 profile 省略时优先取
  // 与基线同名的 profile(同源、零人工配对)。仅当该同名 profile 不存在(旧的无配对基线,如真机采集的
  // linux-chrome-v143 没有对应伪装 profile)才回退 chrome-mac —— 不会误去 load 不存在的文件。
  const pairName = path.basename(file, '.json');
  const prof = profile || (existsSync(path.join(PROFILES_DIR, `${pairName}.json`)) ? pairName : 'chrome-mac');
  const mimicSnap = await snapshotMimic(prof);
  const entries = diff(base, mimicSnap);
  const summary = summarize(entries, { t1Only });
  return { profile: prof, baselineFile: path.relative(process.cwd(), file), baselineMeta: base.meta, mimicSnap, entries, summary };
}

const ICON = { TELL: '✗', EXTRA: '⚠', MISSING: '·', INFO: ' ' };

/** 把报告渲染成可读文本。 */
export function formatReport(report, { verbose = false } = {}) {
  const { profile, baselineFile, entries, summary } = report;
  const lines = [];
  lines.push(`L1 结构 diff — profile=${profile}  baseline=${baselineFile}  scope=${summary.scope}`);
  lines.push('');

  const shown = entries.filter((e) => verbose || e.bucket !== 'INFO');

  // TELL 优先(未白名单的在前),再 EXTRA,MISSING 折叠计数。
  const tells = shown.filter((e) => e.bucket === 'TELL').sort((a, b) => Number(!!a.whitelist) - Number(!!b.whitelist));
  const extras = shown.filter((e) => e.bucket === 'EXTRA');
  const missing = entries.filter((e) => e.bucket === 'MISSING');

  if (tells.length) {
    lines.push(`TELL —— 有此键但形态错(可被识破):`);
    for (const e of tells) lines.push('  ' + fmtEntry(e));
    lines.push('');
  }
  if (extras.length) {
    lines.push(`EXTRA —— mimic 独有(真 Chrome 无,可能泄漏):`);
    for (const e of extras) lines.push('  ' + fmtEntry(e));
    lines.push('');
  }
  if (missing.length) {
    const byTarget = new Map();
    for (const e of missing) byTarget.set(e.targetId, (byTarget.get(e.targetId) || 0) + 1);
    lines.push(`MISSING —— jsdom 覆盖缺口(预期内):${missing.length} 项 / ${byTarget.size} target`);
    if (verbose) for (const e of missing) lines.push('  ' + fmtEntry(e));
    else lines.push('  ' + [...byTarget.keys()].slice(0, 12).join(', ') + (byTarget.size > 12 ? ' …' : ''));
    lines.push('');
  }

  const c = summary.counts;
  const tellBlocked = entries.filter((e) => e.bucket === 'TELL' && !e.whitelist).length;
  const tellWl = (c.TELL || 0) - tellBlocked;
  lines.push(`小计:TELL ${c.TELL || 0}(阻断 ${tellBlocked} / 白名单 ${tellWl}) · EXTRA ${c.EXTRA || 0} · MISSING ${c.MISSING || 0}(覆盖缺口) · INFO ${c.INFO || 0}`);
  lines.push(`GATE(${summary.scope}):${summary.gatePass ? '✅ PASS — 无未白名单 tell' : `❌ FAIL — ${summary.blockers.length} 个阻断项`}`);
  return lines.join('\n');
}

function fmtEntry(e) {
  const where = e.key ? `${e.targetId} · ${e.key}` : e.targetId;
  const wl = e.whitelist ? `  [白名单:${e.whitelist}]` : '';
  const vals = `期望 ${JSON.stringify(e.baseline)} ≠ 实得 ${JSON.stringify(e.mimic)}`;
  return `${ICON[e.bucket] || ' '} ${where}  ${e.field}  ${vals}${wl}`;
}
