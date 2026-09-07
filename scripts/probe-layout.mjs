import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { html, observe, viewport } from './layout-fixture.mjs';
import { captureLayout } from '../dist/src/collect/layout.js';

const directory = await mkdtemp(join(tmpdir(), 'mimic-layout-chrome-'));
const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${directory}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--disable-default-apps', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let launchError;
chrome.on('error', error => { launchError = error; });
let logs = '';
chrome.stderr.on('data', chunk => { logs = (logs + chunk).slice(-4000); });
let socket;
const pending = new Map();
let sequence = 0;
function send(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
try {
  let active;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (launchError) throw launchError;
    try { active = await readFile(join(directory, 'DevToolsActivePort'), 'utf8'); break; } catch {}
    if (chrome.exitCode !== null) throw new Error(logs);
    await delay(50);
  }
  if (!active) throw new Error(`Chrome launch timed out: ${logs}`);
  const [port, path] = active.trim().split('\n');
  socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await once(socket, 'open');
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data);
    const entry = pending.get(result.id);
    if (!entry) return;
    pending.delete(result.id);
    clearTimeout(entry.timer);
    if (result.error) entry.reject(new Error(JSON.stringify(result.error)));
    else entry.resolve(result.result);
  });
  const version = await send('Browser.getVersion');
  const records = [];
  for (const mode of ['root', 'nested', 'touch-action-none', 'prevent-touchmove']) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params = {}) => send(method, params, sessionId);
    const evaluate = async expression => {
      const value = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
      return value.result.value;
    };
    try {
      await call('Page.enable');
      await call('Emulation.setDeviceMetricsOverride', viewport);
      await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      const { frameTree } = await call('Page.getFrameTree');
      await call('Page.setDocumentContent', { frameId: frameTree.frame.id, html: html(mode) });
      await evaluate(`(${observe})(${JSON.stringify(mode)})`);
      await delay(100);
      const before = await evaluate('scrollProbe.snapshot("before")');
      const input = (type, y) => call('Input.dispatchTouchEvent', {
        type, touchPoints: type === 'touchEnd' ? [] : [{ x: 190, y, id: 1, radiusX: 3, radiusY: 3, force: 0.5 }],
      });
      await input('touchStart', 550);
      const selectors = ['html', 'body', ...(mode === 'nested' ? ['#box'] : []), '#band0', '#band1', '#band2', '#band3'];
      const layout = await evaluate(`(() => {
        const first = scrollProbe.rows.find(row => row.type === 'touchstart');
        return (${captureLayout})({ selectors: ${JSON.stringify(selectors)}, paintOrder: ${JSON.stringify([...selectors].reverse())},
          screenOffsetX: first.screenX-first.clientX, screenOffsetY: first.screenY-first.clientY,
          rootPan: 'both', rootOverscroll: 'auto' });
      })()`);
      for (let index = 1; index <= 12; index++) {
        await delay(35);
        await input('touchMove', 550 - index * 22);
      }
      await delay(100);
      await input('touchEnd');
      await delay(500);
      const after = await evaluate('scrollProbe.snapshot("after-swipe")');
      await input('touchStart', 550);
      await input('touchEnd');
      await delay(100);
      const rows = await evaluate('scrollProbe.rows');
      await evaluate('scrollTo(0,600)');
      await delay(100);
      const explicit = await evaluate('scrollProbe.snapshot("after-scrollTo")');
      const events = rows.map(({ type, target, trusted, cancelable, prevented, clientY, pageY, screenY, scrollY, boxScrollTop }) =>
        ({ type, target, trusted, cancelable, prevented, clientY, pageY, screenY, scrollY, boxScrollTop }));
      records.push({ mode, html: html(mode), before, after, explicit, events, layout });
    } finally { await send('Target.closeTarget', { targetId }); }
  }
  const result = { kind: 'local-headless-chrome-mobile-emulation', version, viewport, observer: String(observe), records };
  const json = JSON.stringify(result, null, 2) + '\n';
  if (process.argv[2]) {
    await mkdir(dirname(process.argv[2]), { recursive: true });
    await writeFile(process.argv[2], json);
  }
  else process.stdout.write(json);
} finally {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Probe closed')); }
  socket?.close();
  if (chrome.pid && chrome.exitCode === null) {
    const exited = once(chrome, 'exit');
    const timer = setTimeout(() => chrome.kill('SIGKILL'), 3000);
    chrome.kill('SIGTERM');
    await exited;
    clearTimeout(timer);
  }
  await rm(directory, { recursive: true, force: true });
}
