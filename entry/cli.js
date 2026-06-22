#!/usr/bin/env node
/**
 * 命令入口:
 *   sdenv run    <script> [--profile name] [--trace]
 *   sdenv check  <script> [--profile name]
 *   sdenv serve  [--port 3000]
 *   sdenv profiles
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

async function cmdRun([script], flags) {
  if (!script) return fail('用法: sdenv run <script> [--profile name] [--trace]');
  const code = fs.readFileSync(script, 'utf-8');
  const realm = await Realm.create({ profile: flags.profile, trace: !!flags.trace });
  const out = realm.run(code);
  realm.dispose();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

async function cmdCheck([script], flags) {
  if (!script) return fail('用法: sdenv check <script> [--profile name]');
  const code = fs.readFileSync(script, 'utf-8');
  const realm = await Realm.create({ profile: flags.profile, trace: true });
  const out = realm.run(code);
  console.log('缺失 API:', out.missing);
  console.log('建议 patch:', realm.trace.suggest());
  realm.dispose();
}

async function cmdProfiles() {
  const names = await Profile.list();
  console.log(names.length ? names.join('\n') : '(profiles/ 为空)');
}

async function cmdServe(_rest, flags) {
  const { startServer } = await import('./server.js');
  startServer({ port: Number(flags.port) || 3000 });
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const [, , cmd, ...argv] = process.argv;
const { flags, rest } = parseFlags(argv);
const table = { run: cmdRun, check: cmdCheck, profiles: cmdProfiles, serve: cmdServe };
(table[cmd] || (() => fail('命令: run | check | serve | profiles')))(rest, flags);
