/**
 * trace/monitor —— Proxy 访问监控(get/set/apply/construct 计数与日志)。
 * 取代旧 env/core/ProxyMonitor.js。
 * TODO: 用 mask 友好的方式包裹目标对象,记录访问链,支持对指定 key 触发断点。
 */
export class Monitor {
  constructor() {
    this.stats = { get: 0, set: 0, apply: 0, construct: 0 };
  }

  /** 包裹一个对象返回受监控的代理(stub)。 */
  watch(target /* , name */) {
    return target;
  }

  report() {
    const total = Object.values(this.stats).reduce((a, b) => a + b, 0);
    return { ...this.stats, total };
  }
}
