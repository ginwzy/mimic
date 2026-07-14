#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LegacyProfiles } from '../dist/src/legacy/profiles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_ROOTS = ['package.json', 'package-lock.json', 'profiles', 'resources', 'schemas'];
const SOURCE_FILES = [
  'scripts/build.js',
  'scripts/check-data.js',
  'scripts/generate-shapes.js',
  'resources/probe.js',
];

function filesUnder(relativePath, extension) {
  const absolute = path.join(ROOT, relativePath);
  const stat = fs.statSync(absolute);
  if (!stat.isDirectory()) return path.extname(relativePath) === extension ? [relativePath] : [];
  return fs.readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => filesUnder(path.join(relativePath, entry.name), extension));
}

for (const file of SOURCE_FILES) {
  const checked = spawnSync(process.execPath, ['--check', file], { cwd: ROOT, encoding: 'utf8' });
  if (checked.status !== 0) {
    process.stderr.write(checked.stderr || checked.stdout || `syntax check failed: ${file}\n`);
    process.exit(checked.status ?? 1);
  }
}

const jsonFiles = JSON_ROOTS.flatMap((entry) => filesUnder(entry, '.json')).sort();
for (const file of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`${file}: ${message}`);
    process.exit(1);
  }
}

const profiles = new LegacyProfiles(
  path.join(ROOT, 'profiles'),
  path.join(ROOT, 'resources/shapes'),
);
const profileIds = await profiles.list();
for (const id of profileIds) await profiles.load(id);

console.log(`check: ${SOURCE_FILES.length} scripts, ${jsonFiles.length} JSON files, ${profileIds.length} profiles`);
