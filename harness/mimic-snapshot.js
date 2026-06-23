/**
 * harness/mimic-snapshot.js —— 在 mimic realm 内跑 probe,取回结构快照。
 *
 * 姿势(契约核对源码后确定):probe 内部 JSON.stringify,只把字符串跨回 Node
 * (primitive 无 realm 身份,最稳);realm.run 末尾表达式必须是 string。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Realm } from '../core/realm.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROBE_PATH = path.join(HERE, 'probe.js');

/**
 * @param {string|object} profile  profile 名/对象
 * @returns {Promise<object>} 结构快照(meta.source='mimic')
 */
export async function snapshotMimic(profile) {
  const src = readFileSync(PROBE_PATH, 'utf8');
  const realm = await Realm.create({ profile });
  // 前导分号必须:防 probe 末尾 IIFE 与后续表达式黏连成调用。
  const res = realm.run(`${src}\n;JSON.stringify(window.__probe__());`);
  realm.dispose();
  if (!res.ok) throw new Error(`probe 在 mimic realm 内失败: ${res.error}\n${res.stack || ''}`);
  const snap = JSON.parse(res.value);
  snap.meta = snap.meta || {};
  snap.meta.source = 'mimic';
  snap.meta.profile = typeof profile === 'string' ? profile : (snap.meta.profile || 'anonymous');
  return snap;
}
