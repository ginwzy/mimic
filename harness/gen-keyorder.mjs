/**
 * harness/gen-keyorder —— authoring 期工具:校验 / 再生 DOM 原型 own 键序数据,使其与 harness/baselines 逐元素一致。
 *
 * 为何需要:patch/keyorder-data.js 的 ~1000 条键序 + patch/keyorder.js 的 NAVIGATOR_ORDER 是从 baseline 逐字提取的,
 * 基线一次重采就要人工重新转录,漏改即序错。diff-gate 已端到端守"同集错序"(只给 TELL 计数,不定位);本工具补
 * "逐 index 直连断言":精确定位首处漂移 + 一键机器再生。是 diff-gate 的补充,非替代。
 *
 * 运行期边界:patch 仍 import 静态模块(producer 不读 verifier fixture);本工具只在 authoring/CI 期跑。
 *
 * host→version 钉死:chrome←linux-chrome-v143、webview←android-webview-v138 —— 这两版基线键集与 mimic 注入集相等。
 * 切勿对 v148/v149 断言:其键集与 v143 刻意漂移(customElementRegistry/onanimationcancel 等),mimic 据 v143 注入
 * 故 order 检测休眠(sameSet=false),为它们建表/断言只会产假阴。
 *
 * 用法:
 *   node harness/gen-keyorder.mjs           # 校验(默认):逐 index 比对,任一不符即非零退出并打印首处位置
 *   node harness/gen-keyorder.mjs --write    # 据基线再生 patch/keyorder-data.js(保留文件头注)。NAVIGATOR_ORDER
 *                                            # 嵌在 keyorder.js 其余代码间,--write 不动它,仅由校验守护(小到可手改)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ELEMENT_ORDER, DOCUMENT_ORDER, HTML_ELEMENT_ORDER } from '../patch/keyorder-data.js';
import { NAVIGATOR_ORDER } from '../patch/keyorder.js';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DATA_FILE = path.join(ROOT, 'patch/keyorder-data.js');
const HOST_BASELINE = { chrome: 'linux-chrome-v143', webview: 'android-webview-v138' };

const baselineCache = {};
const baselineTargets = (host) => (baselineCache[host] ??=
  JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/baselines', `${HOST_BASELINE[host]}.json`), 'utf8')).targets);
const ownKeysOf = (host, id) => {
  const t = baselineTargets(host).find((x) => x.id === id);
  return t && t.ownKeys;
};

// 数据表 → baseline target id。前三者住 keyorder-data.js(--write 再生);NAVIGATOR_ORDER 住 keyorder.js(仅校验)。
const TABLES = [
  { name: 'ELEMENT_ORDER', data: ELEMENT_ORDER, id: 'Element.prototype', inDataFile: true },
  { name: 'DOCUMENT_ORDER', data: DOCUMENT_ORDER, id: 'Document.prototype', inDataFile: true },
  { name: 'HTML_ELEMENT_ORDER', data: HTML_ELEMENT_ORDER, id: 'HTMLElement.prototype', inDataFile: true },
  { name: 'NAVIGATOR_ORDER', data: NAVIGATOR_ORDER, id: 'Navigator.prototype', inDataFile: false },
];

/** 逐 index 比对一张表(两 host),返回问题数;打印每对结果。 */
function check() {
  let problems = 0;
  for (const { name, data, id } of TABLES) {
    for (const host of Object.keys(HOST_BASELINE)) {
      const arr = data[host];
      const base = ownKeysOf(host, id);
      if (!arr) { console.log(`  ✗ ${name}[${host}]: 数据缺该 host 表`); problems++; continue; }
      if (!base) { console.log(`  ✗ ${name}[${host}]: 基线 ${HOST_BASELINE[host]} 无 target ${id}`); problems++; continue; }
      let at = -1;
      for (let i = 0; i < Math.max(arr.length, base.length); i++) if (arr[i] !== base[i]) { at = i; break; }
      if (at < 0 && arr.length === base.length) {
        console.log(`  ✓ ${name}[${host}]: ${arr.length} 键与 ${HOST_BASELINE[host]} 精确一致`);
      } else {
        const where = name === 'NAVIGATOR_ORDER' ? 'patch/keyorder.js' : 'patch/keyorder-data.js';
        console.log(`  ✗ ${name}[${host}]: 与 ${HOST_BASELINE[host]} 不符 @${at}`
          + ` (data=${JSON.stringify(arr[at])} base=${JSON.stringify(base[at])}; 长度 data=${arr.length} base=${base.length})`
          + ` —— 修 ${where}${name === 'NAVIGATOR_ORDER' ? '' : ' 或重跑 --write'}`);
        problems++;
      }
    }
  }
  return problems;
}

/** 把键数组渲染成缩进 4、约束行宽的字面量。 */
function emitArray(keys) {
  const lines = [];
  let line = '    ';
  for (const k of keys) {
    const tok = `${JSON.stringify(k)}, `;
    if (line.length + tok.length > 114 && line.trim()) { lines.push(line.replace(/\s+$/, '')); line = '    '; }
    line += tok;
  }
  if (line.trim()) lines.push(line.replace(/\s+$/, ''));
  return lines.join('\n');
}

/** 据基线再生 keyorder-data.js(保留首个 export 前的文件头注)。 */
function write() {
  const src = fs.readFileSync(DATA_FILE, 'utf8');
  const header = src.slice(0, src.indexOf('export const'));
  let out = header;
  for (const { name, id, inDataFile } of TABLES) {
    if (!inDataFile) continue;
    out += `export const ${name} = {\n`;
    for (const host of Object.keys(HOST_BASELINE)) {
      const base = ownKeysOf(host, id);
      if (!base) throw new Error(`基线 ${HOST_BASELINE[host]} 无 target ${id},无法再生 ${name}`);
      out += `  ${host}: [\n${emitArray(base)}\n  ],\n`;
    }
    out += '};\n\n';
  }
  fs.writeFileSync(DATA_FILE, out.replace(/\n+$/, '\n'));
  console.log(`已据基线再生 ${path.relative(ROOT, DATA_FILE)}(NAVIGATOR_ORDER 在 keyorder.js,未改;请重跑校验确认)。`);
}

const mode = process.argv.includes('--write') ? 'write' : 'check';
if (mode === 'write') {
  write();
} else {
  console.log('[keyorder 数据 × baseline 逐 index 校验]');
  const problems = check();
  console.log(`\nkeyorder 数据校验:${problems === 0 ? '全部一致' : `${problems} 处漂移`}`);
  process.exit(problems ? 1 : 0);
}
