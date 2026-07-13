#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profile } from '../core/profile.js';
import { Realm } from '../core/realm.js';
import { serializeResult } from '../core/serialize.js';
import { Session } from '../core/session.js';
import { listBaselines, runDiff } from '../harness/index.js';
import packageJSON from '../package.json' with { type: 'json' };

const SOURCE_COMMIT = '83624a22425c9178ff714d5ca90b332edc70dcf6';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = [
  'harness/probe.js',
  'harness/baselines/android-webview-v138.json',
  'harness/baselines/linux-chrome-v143.json',
  'harness/baselines/macos-chrome-v148.json',
  'harness/baselines/macos-chrome-v149.json',
];
const PAIRS = [
  ['chrome-mac', 'macos-chrome-v148', { extra: 0, tell: 1, missing: 7 }],
  ['macos-chrome-v148', 'macos-chrome-v148', { extra: 0, tell: 0, missing: 7 }],
  ['macos-chrome-v149', 'macos-chrome-v149', { extra: 0, tell: 0, missing: 8 }],
  ['android-webview-v138', 'android-webview-v138', { extra: 0, tell: 0, missing: 0 }],
  ['linux-chrome', 'linux-chrome-v143', { extra: 0, tell: 0, missing: 0 }],
];

const resultShape = ({ ok, value, error, missing }) => ({
  ok,
  missing: missing || [],
  ...(ok ? { value } : { error }),
});

function artifactHashes() {
  return Object.fromEntries(ARTIFACTS.map((file) => [
    file,
    createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex'),
  ]));
}

async function observe(profile) {
  const realm = await Realm.create({ profile });
  try {
    const result = realm.run(`({
      userAgent: navigator.userAgent,
      hasChrome: Object.prototype.hasOwnProperty.call(window, 'chrome'),
      maxTouchPoints: navigator.maxTouchPoints
    })`);
    if (!result.ok) throw new Error(`无法观察 profile ${profile}:${result.error}`);
    return serializeResult(result).value;
  } finally {
    realm.dispose();
  }
}

async function observeExecution() {
  const realm = await Realm.create({ profile: 'chrome-mac' });
  let run;
  let thrown;
  let timeout;
  let encode;
  try {
    run = resultShape(serializeResult(realm.run('1 + 1')));
    thrown = resultShape(serializeResult(realm.run('throw new Error("oracle boom")')));
    timeout = resultShape(serializeResult(realm.run('while (true) {}', { timeoutMs: 10 })));
    encode = resultShape(serializeResult(realm.run('window')));
  } finally {
    realm.dispose();
  }

  const traced = await Realm.create({ profile: 'chrome-mac', trace: true });
  let trace;
  try {
    const result = traced.run(`eval('1 + 2'); OracleMissing.value`);
    trace = {
      missing: result.missing,
      dynamicCode: traced.trace.dynamicCode.length,
    };
  } finally {
    traced.dispose();
  }

  const session = await Session.create({ profile: 'chrome-mac' });
  let capture;
  try {
    const result = await session.capture(`
      (function(){ var x = new XMLHttpRequest(); x.open('POST','https://example.com/sync'); x.send('{"seg":"sync"}'); })();
      window.addEventListener('load', function(){
        var x = new XMLHttpRequest(); x.open('POST','https://example.com/load'); x.send('{"seg":"load"}');
        navigator.sendBeacon('https://example.com/beacon', '{"seg":"beacon"}');
        fetch('https://example.com/fetch', { method:'POST', body:'{"seg":"fetch"}' });
        setTimeout(function(){
          var x2 = new XMLHttpRequest(); x2.open('POST','https://example.com/timer'); x2.send('{"seg":"timer"}');
        }, 10);
      });
    `, {
      scriptUrl: 'https://example.com/oracle.js',
      maxPosts: 5,
      deadlineMs: 1000,
    });
    const segments = {};
    for (const post of result.posts) {
      const segment = post.body && (post.body.match(/"seg":"(\w+)"/) || [])[1];
      if (segment && !(segment in segments)) segments[segment] = post.via;
    }
    capture = {
      syncCaptured: result.syncCaptured,
      first: result.captured && (result.captured.match(/"seg":"(\w+)"/) || [])[1],
      segments,
    };
  } finally {
    session.dispose();
  }

  return { run, throw: thrown, timeout, trace, encode, capture };
}

export async function collectOracle() {
  const profiles = await Profile.list();
  const structure = [];
  for (const [profile, baseline, budget] of PAIRS) {
    const report = await runDiff({ profile, baseline });
    structure.push({
      profile,
      baseline,
      budget,
      actual: {
        extra: report.summary.counts.EXTRA || 0,
        tell: report.summary.counts.TELL || 0,
        missing: report.summary.counts.MISSING || 0,
      },
    });
  }

  return {
    schema: 1,
    source: {
      commit: SOURCE_COMMIT,
      node: process.version,
      jsdom: packageJSON.dependencies.jsdom,
      artifacts: artifactHashes(),
    },
    inventory: {
      profiles: profiles.length,
      baselines: listBaselines().sort(),
    },
    structure,
    behavior: {
      chrome: await observe('chrome-mac'),
      webview: await observe('android-webview-v138'),
    },
    execution: await observeExecution(),
  };
}

export function oracleContract(oracle) {
  const { node: _node, ...source } = oracle.source;
  return { ...oracle, source };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await collectOracle(), null, 2));
}
