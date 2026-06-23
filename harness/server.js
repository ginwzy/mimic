/**
 * harness/server.js —— 结构基线采集服务(零依赖,镜像 capture/server.js)。
 * 真机访问 → 跑 probe → 回传 → 落盘 harness/baselines/<name>.json(complete:true 全量基线)。
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINES_DIR = path.join(HERE, 'baselines');

const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf-8');

/** 文件名消毒 —— 杜绝路径穿越。 */
function safeName(raw) {
  const clean = String(raw || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 64);
  return clean || 'captured';
}

/** 从 UA 粗派生基线名(平台-host-vNNN)。 */
function deriveName(ua) {
  const u = ua || '';
  const platform = /Android/.test(u) ? 'android' : /Mac OS X|Macintosh/.test(u) ? 'mac' : /Windows/.test(u) ? 'win' : /Linux|X11/.test(u) ? 'linux' : 'unknown';
  const host = /\bwv\b/.test(u) ? 'webview' : 'chrome';
  const m = u.match(/Chrom(?:e|ium)\/(\d+)/);
  return [platform, host, m ? `v${m[1]}` : null].filter(Boolean).join('-');
}

function lanURLs(port) {
  const out = [`http://localhost:${port}`];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(`http://${ni.address}:${port}`);
    }
  }
  return out;
}

function saveBaseline(snap, nameHint) {
  snap.meta = snap.meta || {};
  snap.meta.source = 'chrome';
  snap.meta.complete = true; // 真机全量基线
  const name = safeName(nameHint || snap.meta.profile || deriveName(snap.meta.ua));
  snap.meta.profile = snap.meta.profile || name;

  const file = path.join(BASELINES_DIR, `${name}.json`);
  if (path.dirname(path.resolve(file)) !== path.resolve(BASELINES_DIR)) throw new Error('非法路径');
  fs.mkdirSync(BASELINES_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snap, null, 2));

  const targets = (snap.targets || []).length;
  const resolved = (snap.targets || []).filter((t) => t.resolved).length;
  return { name, file: path.relative(process.cwd(), file), targets, resolved };
}

export function startBaselineServer({ port = 8971 } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(read('page.html'));
    }
    if (req.method === 'GET' && url.pathname === '/probe.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(read('probe.js'));
    }
    if (req.method === 'POST' && url.pathname === '/probe') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 2e7) req.destroy(); });
      req.on('end', () => {
        try {
          const snap = JSON.parse(body);
          const result = saveBaseline(snap, url.searchParams.get('name'));
          console.log(`\n✓ 结构基线落盘: ${result.file}  (targets ${result.resolved}/${result.targets} resolved)`);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(result, null, 2));
        } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  server.listen(port, '0.0.0.0', () => {
    console.log('🎯 结构基线采集服务已启动,用目标设备访问(手机需与本机同局域网):');
    for (const u of lanURLs(port)) console.log(`   ${u}`);
    console.log('\n   采集后落盘到 harness/baselines/;随后 `mimic diff <profile> --baseline <name>` 比对。');
    console.log('   Ctrl+C 停止。\n');
  });
  return server;
}
