import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FpEnvProfiles, MimicError, normalizeFpEnv } from '../src/index.js';
import { createMimic } from '../src/sdk.js';

const raw = {
  Date: { Format: 'Tue Apr 01 2025 02:00:00 GMT+0200', TimezoneOffset: -120 },
  'Intl.DateTimeFormat': '1.01.1970',
  'Intl.Timezone': 'Europe/Warsaw',
  devicePixelRatio: 2.75,
  innerWidth: 392,
  innerHeight: 735,
  outerWidth: 393,
  outerHeight: 873,
  navigator: {
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
    appVersion: '5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv81',
    language: 'pl-PL',
    languages: ['pl-PL', 'pl', 'en-US', 'en'],
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 5,
    connection: { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false },
    userAgentData: {
      HighEntropyValues: {
        architecture: '',
        bitness: '',
        brands: [
          { brand: 'Chromium', version: '148' },
          { brand: 'Google Chrome', version: '148' },
          { brand: 'Not/A)Brand', version: '99' },
        ],
        fullVersionList: [
          { brand: 'Chromium', version: '148.0.7778.3' },
          { brand: 'Google Chrome', version: '148.0.7778.3' },
          { brand: 'Not/A)Brand', version: '99.0.0.0' },
        ],
        mobile: true,
        model: '23049PCD8G',
        platform: 'Android',
        platformVersion: '14.0.0',
        uaFullVersion: '148.0.7778.3',
        wow64: false,
      },
    },
  },
  screen: {
    width: 393,
    height: 873,
    availWidth: 393,
    availHeight: 873,
    availLeft: 0,
    availTop: 0,
    colorDepth: 24,
    pixelDepth: 24,
    orientation: { type: 'portrait-primary', angle: 0, onchange: null },
  },
  collect1: {
    getParameter_info: [{
      3379: 8192,
      37445: 'Google Inc. (Qualcomm)',
      37446: 'ANGLE (Qualcomm, Adreno (TM) 725, OpenGL ES 3.2)',
    }],
    canvas_webgl2_SupportedExtensions: ['EXT_color_buffer_float', 'WEBGL_debug_renderer_info'],
    canvas_drawl: { 'w4-h4': 'data:image/png;base64,ignored' },
  },
};

async function fixture(): Promise<{ root: string; id: string; text: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimic-fp-env-'));
  const directory = path.join(root, '_fp-env', 'android_148');
  const text = JSON.stringify(raw);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'z__env_1589412.json'), text);
  return { root, id: 'android-chrome/23049pcd8g-v148-1589412', text };
}

test('FpEnvProfiles maps raw evidence without claiming derived or unsupported fields were captured', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const profiles = new FpEnvProfiles(item.root);

  assert.deepEqual(await profiles.list(), [item.id]);
  const loaded = await profiles.load(item.id);
  assert.deepEqual(loaded.profile.target, {
    engine: 'chromium', host: 'chrome', platform: 'android', form: 'mobile', version: 148,
  });
  assert.equal(loaded.shape.id, 'chromium/chrome/android/mobile/148');
  assert.equal(loaded.shape.level, 'derived');
  assert.equal(loaded.profile.source.hash, createHash('sha256').update(item.text).digest('hex'));
  assert.equal(loaded.profile.navigator.userAgentData.model, '23049PCD8G');
  assert.equal(loaded.profile.navigator.platform, 'Linux armv81');
  assert.equal(loaded.profile.navigator.vendor, 'Google Inc.');
  assert.equal(loaded.profile.navigator.cookieEnabled, true);
  assert.equal(loaded.profile.evidence.navigator.fields.vendor, 'derived');
  assert.equal(loaded.profile.evidence.navigator.fields.cookieEnabled, 'derived');
  assert.equal(loaded.profile.evidence.navigator.fields['userAgentData.model'], 'captured');
  assert.equal(loaded.profile.evidence.screen.fields.availLeft, 'captured');
  assert.equal(loaded.profile.evidence.canvas.support, 'unsupported');
  assert.equal(loaded.profile.evidence.audio.support, 'unsupported');
  assert.deepEqual(loaded.profile.window, {
    innerWidth: 392, innerHeight: 735, outerWidth: 393, outerHeight: 873, devicePixelRatio: 2.75,
  });
  assert.deepEqual(loaded.profile.timezone, { timeZone: 'Europe/Warsaw', offset: -120 });
  assert.equal(loaded.profile.webgl?.unmaskedRenderer, 'ANGLE (Qualcomm, Adreno (TM) 725, OpenGL ES 3.2)');
  assert.deepEqual(loaded.page?.connection, { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false });
});

test('createMimic executes directly from the raw fp-env cache', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const mimic = createMimic({
    profile: item.id,
    profilesRoot: item.root,
    probePath: path.resolve('resources/probe.js'),
    size: 1,
    timeoutMs: 5_000,
  });
  t.after(() => mimic.close());

  const result = await mimic.run({
    kind: 'run',
    code: `({
      vendor: navigator.vendor,
      cookieEnabled: navigator.cookieEnabled,
      width: screen.width,
      outerHeight,
      dpr: devicePixelRatio,
      zone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    })`,
  });
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    vendor: 'Google Inc.',
    cookieEnabled: true,
    width: 393,
    outerHeight: 873,
    dpr: 2.75,
    zone: 'Europe/Warsaw',
  });
  assert.ok((await mimic.list('profiles')).includes(item.id));
});

test('FpEnvProfiles rejects malformed raw records through the Profile error contract', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimic-fp-env-bad-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, '_fp-env', 'android_148');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'z__env_1.json'), JSON.stringify({ navigator: {}, screen: {} }));
  await assert.rejects(
    new FpEnvProfiles(root).list(),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_PROFILE',
  );
});

test('runtime ignores retired Profile JSON and requires an explicit fp-env ID', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimic-fp-env-only-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'chrome-mac.json'), '{"meta":{"name":"chrome-mac"}}');
  const profiles = new FpEnvProfiles(root);
  assert.deepEqual(await profiles.list(), []);
  await assert.rejects(profiles.load('chrome-mac'), /fp-env Profile 不存在/);

  const mimic = createMimic({ profilesRoot: root, size: 1 });
  t.after(() => mimic.close());
  assert.deepEqual(await mimic.list('profiles'), []);
  await assert.rejects(mimic.run({ kind: 'run', code: '1' }), /profile is required/);
});

test('FpEnvProfiles shares immutable normalized records across concurrent loaders without changing evidence', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const [first, second] = await Promise.all([
    new FpEnvProfiles(item.root).load(item.id),
    new FpEnvProfiles(path.join(item.root, '.')).load(item.id),
  ]);
  assert.strictEqual(first, second);
  assert.strictEqual(await new FpEnvProfiles(item.root).load(item.id), first);
  const uncached = await normalizeFpEnv('1589412', raw, first.profile.source);
  assert.deepEqual(first, uncached);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.profile.navigator));
  assert.ok(Object.isFrozen(first.page?.connection));
  assert.throws(() => { first.profile.navigator.vendor = 'modified'; }, TypeError);
});

test('FpEnvProfiles reloads an edited file even when its size and mtime are preserved', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const profiles = new FpEnvProfiles(item.root);
  const file = path.join(item.root, '_fp-env/android_148/z__env_1589412.json');
  const timestamp = new Date('2025-01-01T00:00:00.000Z');
  await utimes(file, timestamp, timestamp);
  const original = await profiles.load(item.id);
  const before = await stat(file);
  const text = JSON.stringify({ ...raw, screen: { ...raw.screen, width: 394 } });
  assert.equal(text.length, item.text.length);
  await writeFile(file, text);
  await utimes(file, before.atime, before.mtime);
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);

  const updated = await profiles.load(item.id);
  assert.notStrictEqual(updated, original);
  assert.equal(original.profile.screen.width, 393);
  assert.equal(updated.profile.screen.width, 394);
  assert.equal(updated.profile.source.hash, createHash('sha256').update(text).digest('hex'));
  assert.strictEqual(await new FpEnvProfiles(item.root).load(item.id), updated);
});

test('FpEnvProfiles refreshes additions, changed IDs, deletions and duplicates in a warm cache', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const profiles = new FpEnvProfiles(item.root);
  await profiles.load(item.id);
  const directory = path.join(item.root, '_fp-env/android_148');
  const addedFile = path.join(directory, 'z__env_2.json');
  const addedId = 'android-chrome/23049pcd8g-v148-2';
  await writeFile(addedFile, item.text);
  assert.equal((await profiles.load(addedId)).profile.id, addedId);
  assert.deepEqual(await profiles.list(), [item.id, addedId].sort());

  const renamed = structuredClone(raw);
  renamed.navigator.userAgentData.HighEntropyValues.model = 'Another Model';
  await writeFile(addedFile, JSON.stringify(renamed));
  await assert.rejects(profiles.load(addedId), /fp-env Profile 不存在/);
  const renamedId = 'android-chrome/another-model-v148-2';
  assert.equal((await profiles.load(renamedId)).profile.id, renamedId);

  const duplicate = path.join(item.root, '_fp-env/nested/duplicate');
  await mkdir(duplicate, { recursive: true });
  await writeFile(path.join(duplicate, 'z__env_1589412.json'), item.text);
  await assert.rejects(new FpEnvProfiles(item.root).load(item.id), /fp-env Profile id 重复/);
  await rm(duplicate, { recursive: true });
  assert.deepEqual(await profiles.list(), [item.id, renamedId].sort());

  await rm(addedFile);
  await assert.rejects(profiles.load(renamedId), /fp-env Profile 不存在/);
  assert.deepEqual(await new FpEnvProfiles(item.root).list(), [item.id]);
});

test('FpEnvProfiles does not retain failed scans or normalization failures', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const profiles = new FpEnvProfiles(item.root);
  await profiles.load(item.id);
  const file = path.join(item.root, '_fp-env/android_148/z__env_1589412.json');
  await writeFile(file, '{');
  await assert.rejects(profiles.load(item.id), /fp-env JSON 非法/);
  await writeFile(file, JSON.stringify({ ...raw, screen: { ...raw.screen, width: 'invalid' } }));
  await assert.rejects(profiles.load(item.id), (error: unknown) => error instanceof MimicError && error.code === 'BAD_PROFILE');
  await writeFile(file, item.text);
  assert.equal((await profiles.load(item.id)).profile.navigator.maxTouchPoints, 5);
});

test('FpEnvProfiles isolates roots and discovers data after an empty scan', async (t) => {
  const item = await fixture();
  const other = await mkdtemp(path.join(os.tmpdir(), 'mimic-fp-env-isolated-'));
  t.after(() => rm(item.root, { recursive: true, force: true }));
  t.after(() => rm(other, { recursive: true, force: true }));
  const first = await new FpEnvProfiles(item.root).load(item.id);
  const profiles = new FpEnvProfiles(other);
  assert.deepEqual(await profiles.list(), []);
  const directory = path.join(other, '_fp-env/android_148');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'z__env_1589412.json'), JSON.stringify({ ...raw, screen: { ...raw.screen, width: 394 } }));
  const second = await profiles.load(item.id);
  assert.notStrictEqual(first, second);
  assert.equal(first.profile.screen.width, 393);
  assert.equal(second.profile.screen.width, 394);
  await rm(path.join(other, '_fp-env'), { recursive: true });
  assert.deepEqual(await profiles.list(), []);
  await assert.rejects(profiles.load(item.id), /fp-env Profile 不存在/);
});
