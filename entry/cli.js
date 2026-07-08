#!/usr/bin/env node
/**
 * 命令分发入口。具体命令实现放在 entry/commands/,按需加载,避免普通 CLI 启动提前拉起 Realm/jsdom。
 */

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

function fail(msg) {
  console.error(msg);
  process.exitCode = 1;
}

const table = {
  run: () => import('./commands/run.js').then((m) => m.runCommand),
  check: () => import('./commands/check.js').then((m) => m.checkCommand),
  profiles: () => import('./commands/profiles.js').then((m) => m.profilesCommand),
  serve: () => import('./commands/serve.js').then((m) => m.serveCommand),
  capture: () => import('./commands/capture.js').then((m) => m.captureCommand),
  diff: () => import('./commands/diff.js').then((m) => m.diffCommand),
  baseline: () => import('./commands/baseline.js').then((m) => m.baselineCommand),
};

const [, , cmd, ...argv] = process.argv;
const { flags, rest } = parseFlags(argv);

Promise.resolve()
  .then(async () => {
    const load = table[cmd];
    if (!load) return fail('命令: run | check | capture | diff | baseline | serve | profiles');
    const handler = await load();
    return handler(rest, flags, fail);
  })
  .catch((e) => fail(`执行失败: ${e.message}`));
