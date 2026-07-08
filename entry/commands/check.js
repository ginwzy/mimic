import fs from 'node:fs';
import { Realm } from '../../core/realm.js';

export async function checkCommand([script], flags, fail) {
  if (!script) return fail('用法: mimic check <script> [--profile name]');
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
