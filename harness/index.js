/**
 * harness/index.js —— L1 diff harness 编程 API + 报告格式化。
 *
 * runDiff:载入真机/种子基线 → mimic 跑同套 probe → diff → summarize → 报告对象。
 * CLI 与测试都走这一个入口。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotMimic } from './mimic-snapshot.js';
import { diff, summarize } from './diff.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASELINES_DIR = path.join(HERE, 'baselines');

/** 解析 baseline:绝对/相对路径直用;裸名到 baselines/<name>.json。 */
function resolveBaseline(ref) {
  if (!ref) return path.join(BASELINES_DIR, 'chrome-mac-seed.json');
  if (ref.endsWith('.json') || ref.includes('/')) return path.resolve(ref);
  return path.join(BASELINES_DIR, `${ref}.json`);
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
 * @param {string} [opts.baseline]  基线名/路径(默认 chrome-mac-seed)
 * @param {boolean} [opts.t1Only]   仅就 T1 已修目标判 gate
 * @returns {Promise<{profile,baseline,entries,summary}>}
 */
export async function runDiff({ profile, baseline, t1Only = false } = {}) {
  const file = resolveBaseline(baseline);
  const base = JSON.parse(readFileSync(file, 'utf8'));
  const prof = profile || base.meta?.profile || 'chrome-mac';
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
    lines.push(`MISSING —— jsdom 覆盖缺口(预期内,yvq.6):${missing.length} 项 / ${byTarget.size} target`);
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
