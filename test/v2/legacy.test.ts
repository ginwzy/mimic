import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LegacyProfiles, MimicError } from '../../src/v2/index.js';

const store = new LegacyProfiles(path.resolve('profiles'));

test('LegacyProfiles splits an inherited WebView profile without inventing data', async () => {
  const imported = await store.load('android-webview');

  assert.equal(imported.profile.id, 'android-webview');
  assert.equal(imported.profile.shape.id, 'chromium/webview/android/mobile/131');
  assert.equal(imported.profile.shape.hash, imported.shape.hash);
  assert.deepEqual(imported.shape.target, {
    engine: 'chromium', host: 'webview', platform: 'android', form: 'mobile', version: 131,
  });
  assert.equal(imported.shape.level, 'derived');
  assert.equal(imported.profile.source.kind, 'manual');
  assert.equal(imported.profile.source.hash.length, 64);
  assert.equal(imported.profile.navigator.vendor, 'Google Inc.');
  assert.equal(imported.profile.navigator.appVersion, imported.profile.navigator.userAgent.replace(/^Mozilla\//, ''));
  assert.equal('connection' in imported.profile.navigator, false);
  assert.equal(imported.profile.window, undefined);

  assert.equal(imported.page?.url, 'https://example.com/');
  assert.deepEqual(imported.page?.clock, { now: 1735689600000, seed: 1985229328 });
  assert.deepEqual(imported.page?.connection, { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false });

  assert.deepEqual(imported.report.chain, ['_base/chromium', 'android-webview']);
  assert.equal(imported.report.ledger['navigator.userAgent']?.target, 'profile.navigator.userAgent');
  assert.equal(imported.report.ledger['navigator.userAgent']?.source?.id, 'android-webview');
  assert.equal(imported.report.ledger['navigator.vendor']?.source?.id, '_base/chromium');
  assert.equal(imported.report.ledger['navigator.connection']?.target, 'page.connection');
  assert.equal(imported.report.ledger['timing.now']?.target, 'page.clock.now');
  assert.equal(imported.report.ledger['meta.traits.host']?.status, 'consumed');
});

test('LegacyProfiles imports the complete v1 corpus into twelve explicit Shapes', async () => {
  const ids = await store.list();
  assert.equal(ids.length, 1012);

  const imported = await Promise.all(ids.map((id) => store.load(id)));
  const shapes = new Map<string, number>();
  const sources = new Map<string, number>();
  let captured = 0;
  let pages = 0;
  for (const item of imported) {
    shapes.set(item.shape.id, (shapes.get(item.shape.id) || 0) + 1);
    sources.set(item.profile.source.kind, (sources.get(item.profile.source.kind) || 0) + 1);
    if (item.shape.level === 'captured') captured++;
    if (item.page) pages++;
    assert.deepEqual(
      Object.entries(item.report.ledger).filter(([, entry]) => entry.status === 'raw-preserved'),
      [],
      `${item.profile.id}:存在未映射旧字段`,
    );
  }

  assert.deepEqual(Object.fromEntries([...shapes].sort()), {
    'chromium/chrome/android/desktop/139': 3,
    'chromium/chrome/android/mobile/130': 1,
    'chromium/chrome/android/mobile/138': 19,
    'chromium/chrome/android/mobile/139': 796,
    'chromium/chrome/android/mobile/140': 185,
    'chromium/chrome/android/mobile/141': 2,
    'chromium/chrome/linux/desktop/143': 1,
    'chromium/chrome/macos/desktop/131': 1,
    'chromium/chrome/macos/desktop/148': 1,
    'chromium/chrome/macos/desktop/149': 1,
    'chromium/webview/android/mobile/131': 1,
    'chromium/webview/android/mobile/138': 1,
  });
  assert.deepEqual(Object.fromEntries([...sources].sort()), { capture: 3, 'fp-env': 1006, manual: 3 });
  assert.equal(captured, 4);
  assert.equal(imported.length - captured, 1008);
  assert.equal(pages, 999);
});

async function withProfiles(files: Record<string, unknown>, run: (profiles: LegacyProfiles) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimic-v2-'));
  try {
    for (const [id, value] of Object.entries(files)) {
      const file = path.join(root, `${id}.json`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(value));
    }
    await run(new LegacyProfiles(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const baseProfile = {
  meta: {
    name: 'base',
    traits: { engine: 'chromium', host: 'chrome', platform: 'android', formFactor: 'mobile', version: 140 },
  },
  navigator: {
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv8l',
    vendor: 'Google Inc.',
    language: 'en',
    languages: ['en'],
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 5,
    cookieEnabled: true,
    userAgentData: { architecture: 'arm' },
  },
  screen: { width: 360, height: 780, availWidth: 360, availHeight: 780, colorDepth: 24, pixelDepth: 24 },
  webgl: { parameters: { '1': 1, '2': 2 }, extensions: [] },
};

test('LegacyProfiles preserves v1 merge rules without mixing identity sections', async () => {
  await withProfiles({
    '_base/base': baseProfile,
    child: {
      meta: { name: 'child', extends: '_base/base' },
      navigator: { userAgentData: { model: 'child' }, languages: ['zh'] },
      webgl: { parameters: { '1': 9 }, extensions: [] },
    },
  }, async (profiles) => {
    const imported = await profiles.load('child');
    assert.equal(imported.profile.navigator.userAgentData.architecture, 'arm');
    assert.equal(imported.profile.navigator.userAgentData.model, 'child');
    assert.deepEqual(imported.profile.navigator.languages, ['zh']);
    assert.deepEqual(imported.profile.webgl?.parameters, { '1': 9 });
  });
});

test('LegacyProfiles reports stable errors for unsafe or contradictory input', async () => {
  await withProfiles({
    good: { ...baseProfile, meta: { ...baseProfile.meta, name: 'good' } },
    cycleA: { ...baseProfile, meta: { ...baseProfile.meta, name: 'cycleA', extends: 'cycleB' } },
    cycleB: { ...baseProfile, meta: { ...baseProfile.meta, name: 'cycleB', extends: 'cycleA' } },
    wrongName: { ...baseProfile, meta: { ...baseProfile.meta, name: 'other' } },
    conflict: {
      ...baseProfile,
      meta: { ...baseProfile.meta, name: 'conflict', traits: { ...baseProfile.meta.traits, host: 'webview' } },
    },
    missingParent: { ...baseProfile, meta: { ...baseProfile.meta, name: 'missingParent', extends: 'absent' } },
    missingNavigator: { meta: { ...baseProfile.meta, name: 'missingNavigator' }, screen: {} },
    missingScreen: { meta: { ...baseProfile.meta, name: 'missingScreen' }, navigator: baseProfile.navigator },
    unknown: { ...baseProfile, meta: { ...baseProfile.meta, name: 'unknown' }, navigator: { ...baseProfile.navigator, typoField: 1 } },
  }, async (profiles) => {
    const code = async (id: string): Promise<string | undefined> => {
      try {
        await profiles.load(id);
        return undefined;
      } catch (error) {
        assert.ok(error instanceof MimicError);
        return error.code;
      }
    };

    assert.equal(await code('../outside'), 'LEGACY_PATH');
    assert.equal(await code('cycleA'), 'LEGACY_CYCLE');
    assert.equal(await code('wrongName'), 'LEGACY_NAME');
    assert.equal(await code('conflict'), 'LEGACY_TRAITS');
    assert.equal(await code('missingParent'), 'LEGACY_PARENT');
    assert.equal(await code('missingNavigator'), 'BAD_PROFILE');
    assert.equal(await code('missingScreen'), 'BAD_PROFILE');
    assert.equal(await code('unknown'), 'BAD_PROFILE');
  });
});

test('LegacyProfiles wraps malformed JSON in the stable profile error contract', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimic-v2-bad-json-'));
  try {
    await writeFile(path.join(root, 'broken.json'), '{');
    const profiles = new LegacyProfiles(root);
    await assert.rejects(
      profiles.load('broken'),
      (error: unknown) => error instanceof MimicError && error.code === 'BAD_PROFILE',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('LegacyProfiles preserves real capture edge cases and provenance', async () => {
  const webview = await store.load('android-webview-v138');
  assert.equal(webview.shape.id, 'chromium/webview/android/mobile/138');
  assert.equal(webview.shape.level, 'captured');
  assert.equal(webview.profile.source.kind, 'capture');
  assert.equal('chrome' in (webview.profile.window || {}), false);
  assert.deepEqual((webview.profile.navigator.userAgentData as { fullVersionList: unknown }).fullVersionList, []);

  const chrome = await store.load('android-chrome/pixel-8-pro-v139-58153');
  assert.equal(chrome.shape.id, 'chromium/chrome/android/mobile/139');
  assert.equal(chrome.report.meta.captureFile, 'z__env_58153.json');

  const zero = await store.load('android-chrome/sm-g970f-v139-57832');
  assert.equal(zero.profile.window?.innerWidth, 0);
  assert.ok(zero.report.warnings.includes('window geometry contains zero'));

  const tablet = await store.load('android-chrome/lenovo-yt-j706x-v139-57421');
  assert.equal(tablet.shape.target.form, 'desktop');

  const noConnection = await store.load('android-chrome/gpu-adreno-tm-610-v139-57987');
  assert.equal(noConnection.page, undefined);
});
