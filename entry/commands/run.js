import fs from 'node:fs';
import { Realm } from '../../core/realm.js';
import { serializeResult } from '../../core/serialize.js';

export async function runCommand([script], flags, fail) {
  if (!script) return fail('用法: mimic run <script> [--profile name] [--url 目标域] [--trace] [--debug]');
  const code = fs.readFileSync(script, 'utf-8');
  const url = typeof flags.url === 'string' ? flags.url : undefined;
  const realm = await Realm.create({
    profile: flags.profile,
    trace: !!flags.trace,
    url,
    debug: !!flags.debug,
  });
  const out = realm.run(code);
  realm.dispose();
  console.log(JSON.stringify(serializeResult(out), null, 2));
  process.exitCode = out.ok ? 0 : 1;
}
