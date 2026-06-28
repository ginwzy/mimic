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
      // 未知依赖:经宿主 console 告警而非静默吞 —— 静默跳过会让 after 里的 typo / 已删 patch 名无声蒸发,
      // 拓扑约束悄悄失效却零诊断(曾有 after:['document'] 悬空依赖长期潜伏)。把它暴露成可见信号。
      else console.warn(`[pipeline] patch '${p.name}' 的 after 依赖 '${dep}' 无对应 patch —— 该拓扑约束被忽略(检查拼写/是否已删)`);
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
      // best-effort:单 patch 抛错不中止流水线(余下 patch 照跑)。但须经宿主 console 发可见信号 —— 否则
      // trace 默认关时 patchError 是 no-op、record.error 仅 describe() 透传,装配抛错在所有默认路径(run/diff/
      // snapshot/session/smoke)无声蒸发,使环境被静默半装,而 diff(首要结构保真门)把半装环境当普通 divergence
      // 报却无"某 patch 没装上"的根因 —— 正是 base/jsdom 力避的"最难定位盲态"在装配层重现。措辞"未完整应用"
      //(非"已跳过"):apply 中途抛错可能已部分应用。同 after 未知依赖告警(上)的"不静默吞失败"纪律。
      console.warn(`[pipeline] patch '${p.name}' apply 抛错 —— 该 patch 未完整应用,环境此面降级:${e.message}`);
      realm.trace?.patchError?.(p.name, e);
    }
  }
  // 全 patch 应用后统一收尾:把所有接口原型的 constructor own 键挪到末位(对齐真机 WebIDL)。集中一处调,
  // 不依赖各 patch 自觉;须在所有 mask.methods 装完后跑,否则后装的方法又把 constructor 顶到非末位。
  realm.mask?.finalizeIfaces?.();
  return decisions;
}
