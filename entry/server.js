/**
 * HTTP 入口(stub)—— 复用 Realm,提供在线执行 / 检测。
 * 取代旧 server/;routes(sandbox/env/ai/snapshot/mock)尚未迁移。
 *
 *   POST /run    { code, profile }      → Realm.create().run(code)
 *   POST /check  { code, profile }      → { missing, suggest }
 *   GET  /profiles
 */
export function startServer({ port = 3000 } = {}) {
  // 未实现:抛错而非 console.log 兜底返回。后者会让 cmdServe 的派发 promise 正常 resolve、进程 exit 0,
  // 脚本化调用 `mimic serve` 据此误判"服务已起";抛错则经 cli.js 的 .catch→fail 落到退出码 1,人类与脚本
  // 都拿到一致的失败信号(也覆盖编程调用)。实现时用 express 在此挂载上方 docblock 的路由,内部统一走 Realm。
  throw new Error(`serve 尚未实现(HTTP 入口待迁移,计划监听 :${port})`);
}
