/**
 * HTTP 入口(stub)—— 复用 Realm,提供在线执行 / 检测。
 * 取代旧 server/。TODO: 迁移 routes(sandbox/env/ai/snapshot/mock)。
 *
 *   POST /run    { code, profile }      → Realm.create().run(code)
 *   POST /check  { code, profile }      → { missing, suggest }
 *   GET  /profiles
 */
export function startServer({ port = 3000 } = {}) {
  // TODO: 用 express 挂载路由,内部统一走 Realm。
  console.log(`[server] stub —— 计划监听 :${port}(待实现)`);
}
