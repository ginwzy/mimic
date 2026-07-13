/**
 * HTTP 入口 —— 经 RealmPool 并行执行,内部统一走 worker(realm 活在 worker 内、结果已序列化)。
 *
 *   POST /run       { code, profile?, url?, scriptUrl?, trace? }  → { ok, value, missing }(已 clone/JSON 安全)
 *   GET  /profiles                                                → string[]
 *
 * 返回句柄 { server, pool, close() } 供编程调用优雅关闭;CLI(mimic serve)走 SIGINT。
 * 默认只监听 127.0.0.1,且 worker 同步脚本有执行上限、等待队列有容量上限。对外暴露须显式传 host,
 * 并由部署层承担认证、TLS 与更细粒度的资源隔离。
 * /check(missing + suggest)待 worker 侧透传 trace.suggest 后补。
 */
import http from 'node:http';
import { RealmPool } from './pool.js';
import { Profile } from '../core/profile.js';

const MAX_BODY = 4 << 20; // 4MB

export function startServer({
  port = 3000,
  host = '127.0.0.1',
  size,
  timeoutMs,
  maxQueue,
} = {}) {
  if (typeof host !== 'string' || !host.trim()) throw new TypeError('host 必须是非空字符串');
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new RangeError('port 必须是 0..65535 的整数');
  const pool = new RealmPool({ size, timeoutMs, maxQueue });

  const readJSON = (req) => new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > MAX_BODY) { req.destroy(); reject(new Error('body 过大')); } });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { reject(new Error('body 非合法 JSON')); } });
    req.on('error', reject);
  });
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/run') {
        const { code, profile, url, scriptUrl, trace } = await readJSON(req);
        if (typeof code !== 'string') return send(res, 400, { ok: false, error: 'code 必须是字符串' });
        return send(res, 200, await pool.run({ code, profile, url, scriptUrl, trace }));
      }
      if (req.method === 'GET' && req.url === '/profiles') {
        return send(res, 200, await Profile.list());
      }
      send(res, 404, { ok: false, error: `未知路由 ${req.method} ${req.url}` });
    } catch (e) {
      const status = e?.code === 'ERR_REALM_POOL_QUEUE_FULL' ? 503 : 400;
      send(res, status, { ok: false, error: e?.message ?? String(e) });
    }
  });

  let closePromise = null;
  const onSigint = () => { close().finally(() => process.exit(0)); };
  const close = () => {
    if (closePromise) return closePromise;
    process.removeListener('SIGINT', onSigint);
    closePromise = (async () => {
      try {
        if (server.listening) {
          await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
        }
      } finally {
        await pool.destroy();
      }
    })();
    return closePromise;
  };
  // listen 失败时调用方未必还会 close();server 自身必须释放已启动的 worker 与进程级信号监听器。
  server.on('error', () => {
    process.removeListener('SIGINT', onSigint);
    void pool.destroy();
  });
  process.once('SIGINT', onSigint);
  try {
    server.listen(port, host, () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      console.log(`mimic serve —— http://${host}:${boundPort}(pool size=${pool.size}, timeout=${pool.timeoutMs}ms, max queue=${pool.maxQueue})`);
    });
  } catch (e) {
    process.removeListener('SIGINT', onSigint);
    void pool.destroy();
    throw e;
  }
  return { server, pool, close };
}
