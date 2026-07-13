import assert from 'node:assert/strict';
import test from 'node:test';
import { MimicError, digest, parseShape, seal } from '../../src/v2/index.js';
import { importLegacyData, legacyTarget } from '../../src/v2/legacy/profiles.js';
import type { Shape, Source } from '../../src/v2/index.js';

function legacyFixture(): Record<string, unknown> {
  return {
    meta: {
      name: 'pure-import',
      traits: { engine: 'chromium', host: 'chrome', platform: 'android', formFactor: 'mobile', version: 140 },
    },
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      vendor: 'Google Inc.',
      language: 'en-US',
      languages: ['en-US', 'en'],
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 5,
      cookieEnabled: true,
      userAgentData: {
        brands: [{ brand: 'Google Chrome', version: '140' }],
        mobile: true,
        platform: 'Android',
        architecture: 'arm',
        bitness: '64',
        fullVersionList: [{ brand: 'Google Chrome', version: '140.0.0.0' }],
        model: 'Pixel',
        platformVersion: '14.0.0',
        uaFullVersion: '140.0.0.0',
        wow64: false,
      },
    },
    screen: {
      width: 412,
      height: 915,
      availWidth: 412,
      availHeight: 915,
      colorDepth: 24,
      pixelDepth: 24,
    },
    location: { href: 'https://example.test/' },
    timing: { now: 1735689600000, seed: 42 },
  };
}

function otherTargetShape(shape: Shape): Shape {
  const { hash: _hash, ...body } = shape;
  const target = { ...shape.target, platform: 'linux' as const, form: 'desktop' as const };
  return parseShape(seal({
    ...body,
    id: `chromium/${target.host}/${target.platform}/${target.form}/${target.version}`,
    target,
  }));
}

test('pure legacy import leaves expanded input unchanged', () => {
  const input = legacyFixture();
  const before = structuredClone(input);

  assert.deepEqual(legacyTarget(input), {
    engine: 'chromium', host: 'chrome', platform: 'android', form: 'mobile', version: 140,
  });
  const imported = importLegacyData('pure-import', input);

  assert.deepEqual(input, before);
  assert.equal(imported.profile.id, 'pure-import');
  assert.equal(imported.page?.url, 'https://example.test/');
});

test('pure legacy import is stable for the same expanded input', () => {
  const input = legacyFixture();

  const first = importLegacyData('pure-import', input);
  const second = importLegacyData('pure-import', structuredClone(input));

  assert.deepEqual(second, first);
  assert.equal(first.profile.source.hash, second.profile.source.hash);
  assert.deepEqual(first.report.chain, ['pure-import']);
});

test('pure legacy import accepts matching custom source and Shape', () => {
  const input = legacyFixture();
  const defaultImport = importLegacyData('pure-import', input);
  const source: Source = {
    kind: 'manual',
    hash: digest({ fixture: 'custom-source' }),
    file: 'fixtures/custom.json',
  };

  const imported = importLegacyData('pure-import', input, { source, shape: defaultImport.shape });

  assert.deepEqual(imported.profile.source, source);
  assert.deepEqual(imported.shape, defaultImport.shape);
  assert.equal(imported.profile.shape.hash, defaultImport.shape.hash);
});

test('pure legacy import rejects a Shape for another target', () => {
  const input = legacyFixture();
  const shape = otherTargetShape(importLegacyData('pure-import', input).shape);

  assert.throws(
    () => importLegacyData('pure-import', input, { shape }),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_SHAPE',
  );
});
