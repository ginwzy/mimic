/**
 * harness/baseline-store.js —— 结构基线落盘 + host/命名派生。
 *
 * 原为与 capture/server.js 镜像的第二个 HTTP 服务(probe-only,端口 8971),已并入统一采集服务(合一
 * 动机见 capture/server.js 头注)。本文件遂退化为纯库:saveBaseline 由统一服务调用,hostOf 供
 * harness/test.js,deriveName 作命名回退。不再自起服务,故无 http/os 依赖。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINES_DIR = path.join(HERE, 'baselines');

/** 文件名消毒 —— 杜绝路径穿越。 */
function safeName(raw) {
  const clean = String(raw || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 64);
  return clean || 'captured';
}

/** host 判定:probe 已采 window.chrome target → 用其 resolved(结构事实优先于 UA)。 */
export function hostOf(snap) {
  const t = (snap.targets || []).find((x) => x.id === 'window.chrome');
  if (t) return t.resolved ? 'chrome' : 'webview';
  return /\bwv\b/.test(snap.meta?.ua || '') ? 'webview' : 'chrome';
}

/** 从 UA(平台/版本)+ 结构信号(host)派生基线名(平台-host-vNNN)。 */
export function deriveName(snap) {
  const u = snap.meta?.ua || '';
  const platform = /Android/.test(u) ? 'android' : /Mac OS X|Macintosh/.test(u) ? 'mac' : /Windows/.test(u) ? 'win' : /Linux|X11/.test(u) ? 'linux' : 'unknown';
  const m = u.match(/Chrom(?:e|ium)\/(\d+)/);
  return [platform, hostOf(snap), m ? `v${m[1]}` : null].filter(Boolean).join('-');
}

/**
 * 把结构快照落盘为 harness/baselines/<name>.json。nameHint 由统一采集服务显式传入(与 profile 同名 →
 * 同源配对);省略时回退 snap.meta.profile / deriveName。meta.profile 写成落盘名,供 runDiff 同名配对。
 */
export function saveBaseline(snap, nameHint) {
  snap.meta = snap.meta || {};
  snap.meta.source = 'chrome';
  snap.meta.complete = true; // 真机全量基线
  // 命名一致性只在调用点保证:统一采集服务恒传 nameHint(与 profile 同一 suggestName 结果)。回退 deriveName
  // 用 mac/win 简称,与 capture/derive.suggestName 的 macos/windows 不一致 —— 仅无 hint 时触发(当前无此路径;
  // 新增无 hint 的 saveBaseline 调用会落到这套不同缩写)。
  const name = safeName(nameHint || snap.meta.profile || deriveName(snap));
  snap.meta.profile = snap.meta.profile || name;

  const file = path.join(BASELINES_DIR, `${name}.json`);
  if (path.dirname(path.resolve(file)) !== path.resolve(BASELINES_DIR)) throw new Error('非法路径');
  fs.mkdirSync(BASELINES_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snap, null, 2));

  const targets = (snap.targets || []).length;
  const resolved = (snap.targets || []).filter((t) => t.resolved).length;
  return { name, file: path.relative(process.cwd(), file), targets, resolved };
}
