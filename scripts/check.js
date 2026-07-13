#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Profile } from '../core/profile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATHS = [
  'base', 'capture', 'core', 'entry', 'harness', 'mask', 'patch', 'scripts', 'tools', 'trace', 'smoke.js',
];
const JSON_PATHS = ['package.json', 'package-lock.json', 'profiles', 'harness/baselines', 'harness/oracles', 'schemas'];

function collect(relativePaths, extensions) {
  const files = [];
  const visit = (relativePath) => {
    const absolutePath = path.join(ROOT, relativePath);
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
        visit(path.join(relativePath, entry.name));
      }
    } else if (extensions.has(path.extname(relativePath))) {
      files.push(relativePath);
    }
  };
  for (const relativePath of relativePaths) visit(relativePath);
  return files.sort();
}

const sourceFiles = collect(SOURCE_PATHS, new Set(['.js', '.mjs']));
for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `syntax check failed: ${file}\n`);
    process.exit(result.status ?? 1);
  }
}

const jsonFiles = collect(JSON_PATHS, new Set(['.json']));
for (const file of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  } catch (error) {
    console.error(`${file}: ${error.message}`);
    process.exit(1);
  }
}

const invalidProfiles = [];
const profileNames = await Profile.list();
for (const name of profileNames) {
  try {
    const profile = await Profile.load(name);
    const problems = profile.validate();
    if (problems.length) invalidProfiles.push(`${name}: ${problems.join('; ')}`);
  } catch (error) {
    invalidProfiles.push(`${name}: ${error.message}`);
  }
}
if (invalidProfiles.length) {
  console.error(`profile check failed:\n${invalidProfiles.map((item) => `  - ${item}`).join('\n')}`);
  process.exit(1);
}

console.log(`check: ${sourceFiles.length} source files, ${jsonFiles.length} JSON files, ${profileNames.length} profiles`);
