#!/usr/bin/env node
/**
 * 命令入口:
 *   mimic run     <script> [--profile name] [--trace]
 *   mimic check   <script> [--profile name]
 *   mimic capture [--port 8970]        起采集服务,目标设备访问后落盘 profile
 *   mimic diff    [profile] [--baseline name] [--t1] [--verbose] [--json]   结构面 mimic-vs-真机 diff
 *   mimic baseline [--port 8971]       起结构基线采集服务,真机访问后落盘到 harness/baselines/
 *   mimic serve   [--port 3000]
 *   mimic profiles
 */
import fs from 'node:fs';
import { Realm } from '../core/realm.js';
import { Profile } from '../core/profile.js';

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) flags[key] = next, i++;
      else flags[key] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

/** 安全序列化 —— eval 结果可能是活的 window/DOM 节点/循环引用,JSON.stringify 会抛。 */
function safeJSON(out) {
  try {
    return JSON.stringify(out, null, 2);
  } catch {
    const desc = Object.prototype.toString.call(out.value);
    return JSON.stringify({ ok: out.ok, value: `[unserializable: ${desc}]`, missing: out.missing }, null, 2);
  }
}

async function cmdRun([script], flags) {
  if (!script) return fail('用法: sdenv run <script> [--profile name] [--trace]');
  const code = fs.readFileSync(script, 'utf-8');
  const realm = await Realm.create({ profile: flags.profile, trace: !!flags.trace });
  const out = realm.run(code);
  realm.dispose();
  console.log(safeJSON(out));
  process.exit(out.ok ? 0 : 1);
}

async function cmdCheck([script], flags) {
  if (!script) return fail('用法: sdenv check <script> [--profile name]');
  const code = fs.readFileSync(script, 'utf-8');
  const realm = await Realm.create({ profile: flags.profile, trace: true });
  try {
    const out = realm.run(code);
    console.log('缺失 API:', out.missing);
    console.log('建议 patch:', realm.trace.suggest());
  } finally {
    realm.dispose();
  }
}

async function cmdProfiles() {
  const names = await Profile.list();
  console.log(names.length ? names.join('\n') : '(profiles/ 为空)');
}

async function cmdServe(_rest, flags) {
  const { startServer } = await import('./server.js');
  startServer({ port: Number(flags.port) || 3000 });
}

async function cmdCapture(_rest, flags) {
  const { startCapture } = await import('../capture/server.js');
  startCapture({ port: Number(flags.port) || 8970 });
}

async function cmdDiff([profile], flags) {
  const { runDiff, formatReport, listBaselines } = await import('../harness/index.js');
  try {
    const report = await runDiff({
      profile: profile || flags.profile,
      baseline: typeof flags.baseline === 'string' ? flags.baseline : undefined,
      t1Only: !!flags.t1,
    });
    if (flags.json) console.log(JSON.stringify({ summary: report.summary, entries: report.entries }, null, 2));
    else console.log(formatReport(report, { verbose: !!flags.verbose }));
    process.exit(report.summary.gatePass ? 0 : 1);
  } catch (e) {
    console.error(`diff 失败: ${e.message}`);
    const names = listBaselines();
    if (names.length) console.error(`可用基线: ${names.join(', ')}`);
    process.exit(2);
  }
}

async function cmdBaseline(_rest, flags) {
  const { startBaselineServer } = await import('../harness/server.js');
  startBaselineServer({ port: Number(flags.port) || 8971 });
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const [, , cmd, ...argv] = process.argv;
const { flags, rest } = parseFlags(argv);
const table = { run: cmdRun, check: cmdCheck, profiles: cmdProfiles, serve: cmdServe, capture: cmdCapture, diff: cmdDiff, baseline: cmdBaseline };
// 统一兜底:同步抛(readFileSync ENOENT)与 async 抛(Realm.create)都落到 fail(),不再裸堆栈崩溃。
Promise.resolve()
  .then(() => (table[cmd] || (() => fail('命令: run | check | capture | diff | baseline | serve | profiles')))(rest, flags))
  .catch((e) => fail(`执行失败: ${e.message}`));
