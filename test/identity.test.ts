import assert from 'node:assert/strict';
import test from 'node:test';
import { MimicError, digest, parseShape, seal } from '../src/index.js';
import { normalizeIdentity, targetShape, identityTarget } from '../src/collect/identity.js';
import type { Shape, Source } from '../src/index.js';

function identityFixture(): Record<string, unknown> {
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

test('identity normalization leaves identity input unchanged', async () => {
  const input = identityFixture();
  const before = structuredClone(input);

  assert.deepEqual(identityTarget(input), {
    engine: 'chromium', host: 'chrome', platform: 'android', form: 'mobile', version: 140,
  });
  const imported = normalizeIdentity('pure-import', input, { shape: await targetShape(identityTarget(input)) });

  assert.deepEqual(input, before);
  assert.equal(imported.profile.id, 'pure-import');
  assert.equal(imported.page?.url, 'https://example.test/');
});

test('identity normalization is stable for the same identity input', async () => {
  const input = identityFixture();
  const shape = await targetShape(identityTarget(input));

  const first = normalizeIdentity('pure-import', input, { shape });
  const second = normalizeIdentity('pure-import', structuredClone(input), { shape });

  assert.deepEqual(second, first);
  assert.equal(first.profile.source.hash, second.profile.source.hash);
  assert.deepEqual(first.report.chain, ['pure-import']);
});

test('identity normalization accepts matching custom source and Shape', async () => {
  const input = identityFixture();
  const defaultImport = normalizeIdentity('pure-import', input, { shape: await targetShape(identityTarget(input)) });
  const source: Source = {
    kind: 'manual',
    hash: digest({ fixture: 'custom-source' }),
    file: 'fixtures/custom.json',
  };

  const imported = normalizeIdentity('pure-import', input, { source, shape: defaultImport.shape });

  assert.deepEqual(imported.profile.source, source);
  assert.deepEqual(imported.shape, defaultImport.shape);
  assert.equal(imported.profile.shape.hash, defaultImport.shape.hash);
});

test('identity normalization rejects a Shape for another target', async () => {
  const input = identityFixture();
  const shape = otherTargetShape(normalizeIdentity('pure-import', input, { shape: await targetShape(identityTarget(input)) }).shape);

  assert.throws(
    () => normalizeIdentity('pure-import', input, { shape }),
    (error: unknown) => error instanceof MimicError && error.code === 'BAD_SHAPE',
  );
});
