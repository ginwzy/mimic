/**
 * patch/clock —— 确定性时间与随机数(过 Akamai 这类强检测、复现签名的关键)。
 * 对照 sdenv-extend: handle/dateAndRandomHandle.js(录制 / 回放)。
 *
 * 当前为最小可用版:profile.timing 提供固定基准 → Date.now / Math.random 确定化。
 * TODO: 实现 record 模式(跑真实实现并记录序列)+ replay 模式(按序回放)。
 */
export default {
  name: 'clock',
  after: [],
  apply({ window, profile, mask }) {
    const t = profile.section('timing');
    if (t.now == null && t.seed == null) return; // 未配置则不接管,保持真实

    if (t.now != null) {
      const fixedNow = t.now;
      window.Date.now = mask.fn(function now() { return fixedNow; }, 'now');
    }

    if (t.seed != null) {
      // 简单可复现 PRNG(mulberry32),仅作占位,真实回放应录制浏览器序列。
      let s = t.seed >>> 0;
      window.Math.random = mask.fn(function random() {
        s |= 0; s = (s + 0x6d2b79f5) | 0;
        let x = Math.imul(s ^ (s >>> 15), 1 | s);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      }, 'random');
    }
  },
};
