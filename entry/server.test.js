/**
 * entry/server.test.js —— HTTP 执行边界自测。
 *   node entry/server.test.js
 */
import http from 'node:http';
import { once } from 'node:events';
import { startServer } from './server.js';

let pass = 0; let fail = 0;
const ok = (name, condition) => {
  if (condition) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

function request(port, { method = 'GET', path = '/', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: payload ? {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      } : undefined,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload); else req.end();
  });
}

console.log('[HTTP server 自测]');
const handle = startServer({ port: 0, size: 1, timeoutMs: 50, maxQueue: 0 });
try {
  await once(handle.server, 'listening');
  const address = handle.server.address();
  ok('默认只绑定 IPv4 loopback', address?.address === '127.0.0.1');
  const port = address.port;

  const invalid = await request(port, { method: 'POST', path: '/run', body: { code: 7 } });
  ok('非法 /run 请求返回 400 JSON', invalid.status === 400 && invalid.body?.ok === false);

  const timed = await request(port, {
    method: 'POST',
    path: '/run',
    body: { profile: 'android-webview-v138', code: 'while (true) {}' },
  });
  ok('HTTP 默认配置贯穿到同步脚本超时', timed.status === 200
    && timed.body?.ok === false
    && /timed out|timeout/i.test(timed.body?.error));

  // maxQueue=0 时直接占满同一 server pool 的执行槽,再从 HTTP 入口验证背压状态码。
  const running = handle.pool.run({ profile: 'android-webview-v138', code: 'while (true) {}' });
  const overloaded = await request(port, {
    method: 'POST',
    path: '/run',
    body: { profile: 'android-webview-v138', code: '1' },
  });
  ok('maxQueue=0 时第二个并发 HTTP 任务返回 503', overloaded.status === 503 && overloaded.body?.ok === false);
  await running;

  const recovered = await request(port, {
    method: 'POST',
    path: '/run',
    body: { profile: 'android-webview-v138', code: '21 * 2' },
  });
  ok('HTTP 超时后 worker 继续执行后续任务', recovered.status === 200
    && recovered.body?.ok === true
    && recovered.body?.value === 42);

  const missing = await request(port, { path: '/not-found' });
  ok('未知路由保持 404 JSON', missing.status === 404 && missing.body?.ok === false);
} finally {
  await handle.close();
}
await handle.close();
let closedError = null;
try {
  await handle.pool.run({ code: '1' });
} catch (e) {
  closedError = e;
}
ok('close 幂等且等待 pool 完成销毁', /destroy/.test(closedError?.message));

// 监听失败也必须自动清掉构造时已拉起的 worker,不能依赖调用方补一次 close。
const blocker = http.createServer();
blocker.listen(0, '127.0.0.1');
await once(blocker, 'listening');
const blockedPort = blocker.address().port;
const failedHandle = startServer({ port: blockedPort, size: 1, timeoutMs: 50, maxQueue: 0 });
const [listenError] = await once(failedHandle.server, 'error');
await failedHandle.close();
let destroyedError = null;
try {
  await failedHandle.pool.run({ code: '1' });
} catch (e) {
  destroyedError = e;
}
ok('listen 失败后 pool 已销毁', listenError?.code === 'EADDRINUSE' && /destroy/.test(destroyedError?.message));
await new Promise((resolve, reject) => blocker.close((e) => (e ? reject(e) : resolve())));

console.log(`\nHTTP server 自测:${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
