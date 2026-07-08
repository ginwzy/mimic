/**
 * 统一采集服务 —— 托管单页,一次设备访问、一个 session 内同源产出 profile + baseline。
 * 用 node:http(零额外依赖)。同一 URL 桌面/手机/WebView 皆可访问。
 *
 * 为何合一(原 capture/harness 两服务的痛点):真机原需访问两个 URL、跑两次采集才能凑齐 profile(身份值)
 * 与 baseline(结构面),且两者可能来自不同 session/设备/版本 → 漂移(diff 拿一个设备的结构基线比另一个
 * 设备派生的 profile,失真难察),命名还各算各的(macos vs mac)永配不上对。合一后:页面一次性跑
 * __probe__()(先,洁净环境)+ __capture__(),POST {profileRaw,probeSnapshot};服务端派生一次 name,
 * 同名落 profiles/<name>.json 与 harness/baselines/<name>.json,baseline.meta.profile=name 显式配对。
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profile } from '../core/profile.js';
import { finalize, deriveTraits, suggestName } from './derive.js';
import { saveBaseline } from '../harness/baseline-store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.resolve(HERE, '../profiles');
const PROBE_PATH = path.resolve(HERE, '../harness/probe.js');

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

/** 落盘身份值 profile。name 已由调用方派生(与 baseline 同名 → 同源配对)。 */
function saveProfile(raw, name) {
  const traits = deriveTraits(raw);
  const profile = finalize(raw, name);

  const file = path.join(PROFILES_DIR, `${name}.json`);
  if (path.dirname(path.resolve(file)) !== path.resolve(PROFILES_DIR)) throw new Error('非法路径');
  fs.writeFileSync(file, JSON.stringify(profile, null, 2));

  const problems = new Profile(profile).validate();
  return { name, file: path.relative(process.cwd(), file), traits, fidelity: profile.meta.fidelity, problems };
}

/**
 * 拆分统一负载:新页面 POST {profileRaw, probeSnapshot};兼容旧的"裸 profile"直接 POST(无 probe)。
 * profileRaw 是配对的命名锚点(身份值含 UA → 派生 traits/name),故必有;probeSnapshot 可选。
 */
function splitPayload(body) {
  if (body && (body.profileRaw || body.probeSnapshot)) {
    return { profileRaw: body.profileRaw || null, probeSnapshot: body.probeSnapshot || null };
  }
  return { profileRaw: body, probeSnapshot: null };
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
    if (req.method === 'GET' && url.pathname === '/probe.js') {
      // probe.js 住在 harness/(diff 的真相源,mimic 侧 mimic-snapshot.js 也复用同一份),此处跨目录直读。
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(fs.readFileSync(PROBE_PATH, 'utf-8'));
    }
    if (req.method === 'POST' && url.pathname === '/capture') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 2e7) req.destroy(); }); // 20MB:容 probe 全量快照
      req.on('end', () => {
        try {
          const { profileRaw, probeSnapshot } = splitPayload(JSON.parse(body));
          if (!profileRaw && !probeSnapshot) throw new Error('负载空(profileRaw / probeSnapshot 皆缺)');
          // 命名锚点优先取 profileRaw(身份值含 UA);若其缺失(客户端 capture 半失败,仅 probe 成功),
          // 让 name=null → saveBaseline 自派生(从 probe.meta.ua),保证"只采到 probe"那半也能独立落盘。
          const hint = url.searchParams.get('name') || (profileRaw ? suggestName(deriveTraits(profileRaw)) : null);
          const name = hint ? safeName(hint) : null;
          const out = {};

          // 两侧落盘各自 try/catch:一侧失败/缺失不拖累另一侧(与客户端两半独立采集对称,不退化成 all-or-nothing)。
          if (profileRaw) {
            try {
              out.profile = saveProfile(profileRaw, name);
              console.log(`\n✓ profile 落盘: ${out.profile.file}`);
              console.log(`  traits: ${JSON.stringify(out.profile.traits)}`);
              const absent = Object.entries(out.profile.fidelity).filter(([, v]) => v === 'absent').map(([k]) => k);
              if (absent.length) console.log(`  ⚠ 渲染类未采集(absent): ${absent.join(', ')} —— 该 profile 部分合成`);
              if (out.profile.problems.length) console.log(`  ⚠ 自洽性: ${out.profile.problems.join('; ')}`);
            } catch (e) { out.profileError = e.message; console.log(`\n✗ profile 落盘失败: ${e.message}`); }
          }

          if (probeSnapshot) {
            try {
              out.baseline = saveBaseline(probeSnapshot, name); // name 非空时同名 → baseline.meta.profile=name 显式配对
              console.log(`✓ baseline 落盘: ${out.baseline.file}  (targets ${out.baseline.resolved}/${out.baseline.targets} resolved)`);
            } catch (e) { out.baselineError = e.message; console.log(`✗ baseline 落盘失败: ${e.message}`); }
          }

          out.name = out.profile?.name || out.baseline?.name;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(out, null, 2));
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
    console.log('🎯 统一采集服务已启动,用目标设备访问下列任一地址(手机需与本机同局域网):');
    for (const u of lanURLs(port)) console.log(`   ${u}`);
    console.log('\n   桌面 Chrome / Android Chrome / WebView 均可;一次访问同源落 profiles/<name>.json + harness/baselines/<name>.json。');
    console.log('   Ctrl+C 停止。\n');
  });
  return server;
}
