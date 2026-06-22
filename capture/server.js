/**
 * 采集服务 —— 托管采集页,接收设备回传,落盘为 profile。
 * 用 node:http(零额外依赖)。同一 URL 桌面/手机/WebView 皆可访问。
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profile } from '../core/profile.js';
import { finalize, deriveTraits, suggestName } from './derive.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.resolve(HERE, '../profiles');

const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf-8');

/** 文件名消毒 —— 只允许安全字符,杜绝路径穿越。 */
function safeName(raw) {
  const clean = String(raw || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64);
  return clean || 'captured';
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

function saveProfile(raw, nameHint) {
  const traits = deriveTraits(raw);
  const name = safeName(nameHint || suggestName(traits));
  const profile = finalize(raw, name);

  const file = path.join(PROFILES_DIR, `${name}.json`);
  if (path.dirname(path.resolve(file)) !== path.resolve(PROFILES_DIR)) throw new Error('非法路径');
  fs.writeFileSync(file, JSON.stringify(profile, null, 2));

  const problems = new Profile(profile).validate();
  return { name, file: path.relative(process.cwd(), file), traits, fidelity: profile.meta.fidelity, problems };
}

export function startCapture({ port = 8970 } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(read('page.html'));
    }
    if (req.method === 'GET' && url.pathname === '/collect.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(read('collect.js'));
    }
    if (req.method === 'POST' && url.pathname === '/capture') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
      req.on('end', () => {
        try {
          const raw = JSON.parse(body);
          const result = saveProfile(raw, url.searchParams.get('name'));
          console.log(`\n✓ 采集落盘: ${result.file}`);
          console.log(`  traits: ${JSON.stringify(result.traits)}`);
          const absent = Object.entries(result.fidelity).filter(([, v]) => v === 'absent').map(([k]) => k);
          if (absent.length) console.log(`  ⚠ 渲染类未采集(absent): ${absent.join(', ')} —— 该 profile 部分合成`);
          if (result.problems.length) console.log(`  ⚠ 自洽性: ${result.problems.join('; ')}`);
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
    console.log('🎯 采集服务已启动,用目标设备访问下列任一地址(手机需与本机同局域网):');
    for (const u of lanURLs(port)) console.log(`   ${u}`);
    console.log('\n   桌面 Chrome / Android Chrome / WebView 均可;采集后自动落盘到 profiles/。');
    console.log('   Ctrl+C 停止。\n');
  });
  return server;
}
