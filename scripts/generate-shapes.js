#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'resources/shapes');
const modulePath = path.join(root, 'dist/src/legacy/profiles.js');
const { legacyShape } = await import(pathToFileURL(modulePath).href);
const ids = [
  'chromium/chrome/android/desktop/139',
  'chromium/chrome/android/mobile/130',
  'chromium/chrome/android/mobile/138',
  'chromium/chrome/android/mobile/139',
  'chromium/chrome/android/mobile/140',
  'chromium/chrome/android/mobile/141',
  'chromium/chrome/android/mobile/145',
  'chromium/chrome/linux/desktop/143',
  'chromium/chrome/macos/desktop/131',
  'chromium/chrome/macos/desktop/148',
  'chromium/chrome/macos/desktop/149',
  'chromium/webview/android/mobile/131',
  'chromium/webview/android/mobile/138',
];
const check = process.argv.includes('--check');
const files = {};
let changed = false;

for (const id of ids) {
  const [, host, platform, form, rawVersion] = id.split('/');
  const shape = legacyShape({ engine: 'chromium', host, platform, form, version: Number(rawVersion) });
  const text = `${JSON.stringify(shape)}\n`;
  const relative = `${id}.json`;
  const file = path.join(output, relative);
  files[id] = { file: relative, sha256: createHash('sha256').update(text).digest('hex') };
  let current;
  try { current = readFileSync(file, 'utf8'); } catch { current = undefined; }
  if (current !== text) {
    changed = true;
    if (!check) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
  }
}

const manifestText = `${JSON.stringify({ schema: 1, files }, null, 2)}\n`;
const manifest = path.join(output, 'manifest.json');
let currentManifest;
try { currentManifest = readFileSync(manifest, 'utf8'); } catch { currentManifest = undefined; }
if (currentManifest !== manifestText) {
  changed = true;
  if (!check) {
    mkdirSync(output, { recursive: true });
    writeFileSync(manifest, manifestText);
  }
}

if (check && changed) {
  console.error('Shape resources are stale; run npm run generate:shapes');
  process.exit(1);
}
console.log(JSON.stringify({ shapes: ids.length, changed }));
