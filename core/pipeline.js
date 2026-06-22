/**
 * 装配流水线 —— 按 patch 的 `after` 拓扑排序,再按 `applies(traits)` 门控,依次 apply。
 * 记录每个 patch 的门控决策,供 realm.describe() 内省。
 */

/**
 * @param {Array<{name:string, after?:string[], applies?:Function, apply:Function}>} patches
 * @param {object} realm  含 window/profile/mask/traits/trace
 * @returns {Array<{name:string, applied:boolean, reason:string, error?:string}>} 决策记录
 */
export function runPipeline(patches, realm) {
  const byName = new Map(patches.map((p) => [p.name, p]));
  const done = new Set();
  const visiting = new Set();
  const order = [];

  function visit(p) {
    if (done.has(p.name)) return;
    if (visiting.has(p.name)) throw new Error(`patch 循环依赖: ${p.name}`);
    visiting.add(p.name);
    for (const dep of p.after || []) {
      const d = byName.get(dep);
      if (d) visit(d);
    }
    visiting.delete(p.name);
    done.add(p.name);
    order.push(p);
  }
  patches.forEach(visit);

  const decisions = [];
  for (const p of order) {
    const gated = typeof p.applies === 'function';
    const applied = !gated || p.applies(realm.traits);
    const record = { name: p.name, applied, reason: applied ? (gated ? 'match' : 'always') : 'skip' };
    decisions.push(record);
    if (!applied) continue;
    try {
      p.apply(realm);
    } catch (e) {
      record.error = e.message;
      realm.trace?.patchError?.(p.name, e);
    }
  }
  return decisions;
}
