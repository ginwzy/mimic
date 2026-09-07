import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEnvironment, parseEnvironmentOptions, regionalProfile, environmentAcceptLanguage } from '../src/core/environment.js';
import { listRegions, regionalCatalog } from '../src/core/regions.js';
import { createMimic } from '../src/public.js';
import { validHash } from '../src/core/seal.js';
import { FpEnvProfiles } from '../src/profiles/fp-env.js';
import { createNodeApplication } from '../src/node/app.js';
import { WorkerExecutor } from '../src/executor/pool.js';
import { CapturePool, captureBodies } from '../flow/capture.js';

const profilesRoot = 'test/fixtures/fp-env';
const profile = 'android-webview/unknown-v138-1';
const japan = parseEnvironment({ regional: { languages: ['ja-JP', 'ja', 'en-US', 'en'], locale: 'ja-JP', timeZone: 'Asia/Tokyo' } });
const poland = parseEnvironment({ regional: { languages: ['pl-PL', 'pl'], locale: 'pl-PL', timeZone: 'Europe/Warsaw' } });

test('regional profiles preserve device evidence and isolate deterministic Plan variants', async () => {
  const profiles = new FpEnvProfiles(profilesRoot);
  const base = (await profiles.load(profile)).profile;
  const first = regionalProfile(base, japan);
  assert.notEqual(first.hash, base.hash);
  assert.equal(first.hash, regionalProfile(base, japan).hash);
  assert.notEqual(first.hash, regionalProfile(base, poland).hash);
  assert.ok(validHash(first));
  assert.ok(Object.isFrozen(first));
  assert.equal(first.id, base.id);
  assert.deepEqual(first.source.kind === 'derived' && first.source.base, { id: base.id, hash: base.hash });
  assert.deepEqual(first.screen, base.screen);
  assert.deepEqual(first.navigator.userAgentData, base.navigator.userAgentData);
  assert.deepEqual(first.shape, base.shape);
  assert.equal(first.evidence.navigator.fields.language, 'derived');
  assert.equal(first.evidence.navigator.fields['userAgentData.model'], base.evidence.navigator.fields['userAgentData.model']);
  assert.equal(first.evidence.timezone.support, 'derived');
  assert.strictEqual((await new FpEnvProfiles(profilesRoot).load(profile)).profile, base);
  assert.equal(base.navigator.language, 'en-US');
  assert.equal(base.timezone?.timeZone, 'Asia/Shanghai');

  const app = createNodeApplication({ profilesRoot });
  const request = { profile, job: { kind: 'run' as const, code: 'navigator.language' }, environment: japan };
  const plan = await app.plan(request);
  assert.strictEqual(await app.plan(request), plan);
  assert.notEqual((await app.plan({ ...request, environment: poland })).id, plan.id);
  assert.notEqual((await app.plan({ profile, job: request.job })).id, plan.id);
});

test('regional input rejects invalid or incomplete settings and derives ordered language headers', () => {
  assert.equal(environmentAcceptLanguage(japan), 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7');
  assert.deepEqual(parseEnvironment({ regional: { languages: ['ja-jp'], locale: 'ja-jp', timeZone: 'asia/tokyo' } }),
    { regional: { languages: ['ja-JP'], locale: 'ja-JP', timeZone: 'Asia/Tokyo' } });
  for (const input of [null, {}, { regional: {} },
    { regional: { ...japan.regional, languages: [] } },
    { regional: { ...japan.regional, languages: ['ja-JP', 'ja-jp'] } },
    { regional: { ...japan.regional, languages: ['ja-JP\r\nx-test: x'] } },
    { regional: { ...japan.regional, locale: 'invalid_locale' } },
    { regional: { ...japan.regional, timeZone: 'not/a-zone' } },
    { regional: { ...japan.regional, timeZone: '+09:00' } },
    { regional: { ...japan.regional, typo: true } },
  ]) assert.throws(() => parseEnvironment(input), { code: 'BAD_PROFILE' });
});

test('regional catalog exposes source coverage and rejects unsupported or mismatched selections', () => {
  const all = listRegions({ supportedOnly: false });
  assert.equal(all.length, regionalCatalog.presetCount);
  assert.equal(new Set(all.map(({ country }) => country)).size, regionalCatalog.countryCount);
  assert.equal(new Set(all.map(({ id }) => id)).size, all.length);
  assert.ok(all.every((preset) => preset.evidence === 'derived'));
  for (const preset of listRegions()) {
    const selected = parseEnvironment({ regional: { preset: preset.id } });
    assert.equal(selected.regional.locale, preset.locale);
    assert.deepEqual(parseEnvironment(JSON.parse(JSON.stringify(selected))), selected);
  }
  for (const preset of all.filter(({ supported }) => !supported)) {
    assert.ok(preset.unsupported.length);
    assert.throws(() => parseEnvironment({ regional: { preset: preset.id } }), { code: 'BAD_PROFILE' });
  }
  const selected = parseEnvironment({ regional: { preset: 'jp-ja-tokyo' } });
  assert.throws(() => parseEnvironment({ ...selected, selection: { ...selected.selection, catalog: 'unknown' } }), { code: 'BAD_PROFILE' });
  assert.throws(() => parseEnvironment({ ...selected, regional: poland.regional }), { code: 'BAD_PROFILE' });
  for (const regional of [{ preset: 'missing' }, { preset: 'jp-ja-tokyo', random: true },
    { random: false }, { random: true, countries: [] }, { random: true, countries: ['ZZ'] },
    { random: true, countries: ['AQ'] }, { random: true, seed: '' }, { random: true, typo: true },
  ]) assert.throws(() => parseEnvironment({ regional }), { code: 'BAD_PROFILE' });
});

test('region randomness is seeded, country-balanced and unresolved until a flow begins', () => {
  const input = { regional: { random: true, countries: ['JP', 'US', 'GB'] } };
  assert.deepEqual(parseEnvironmentOptions(input), { regional: { random: true, countries: ['GB', 'JP', 'US'] } });
  const counts: Record<string, number> = {};
  for (let index = 0; index < 600; index += 1) {
    const request = { regional: { ...input.regional, seed: `country-balance-${index}` } };
    const selected = parseEnvironment(request);
    assert.deepEqual(parseEnvironment(request), selected);
    assert.deepEqual(parseEnvironment({ regional: { ...request.regional, countries: ['us', 'jp', 'gb', 'jp'] } }), selected);
    const country = selected.selection!.country;
    counts[country] = (counts[country] ?? 0) + 1;
    assert.ok(Object.isFrozen(selected.regional.languages));
  }
  for (const country of input.regional.countries) assert.ok(counts[country]! > 140 && counts[country]! < 260, JSON.stringify(counts));
  const random = parseEnvironment(input);
  assert.ok(random.selection?.seed);
  assert.deepEqual(parseEnvironment({ regional: { ...input.regional, seed: random.selection.seed } }), random);
});

test('Accept-Language follows Chromium 145 expansion, de-duplication and minimum q=0.1', () => {
  for (const [languages, header] of [
    [['en-US'], 'en-US,en;q=0.9'],
    [['en-US', 'en-CA', 'fr'], 'en-US,en-CA;q=0.9,en;q=0.8,fr;q=0.7'],
    [['en-US', 'en-CA', 'fr', 'en-AU'], 'en-US,en-CA;q=0.9,en;q=0.8,fr;q=0.7,en-AU;q=0.6'],
    [['en-US', 'fr-CA', 'it', 'fr', 'es-AR', 'it-IT'], 'en-US,en;q=0.9,fr-CA;q=0.8,fr;q=0.7,it;q=0.6,es-AR;q=0.5,es;q=0.4,it-IT;q=0.3'],
    [['en', 'fr', 'de', 'ko', 'zh-CN', 'ja', 'es', 'it', 'pt', 'nl', 'sv'], 'en,fr;q=0.9,de;q=0.8,ko;q=0.7,zh-CN;q=0.6,zh;q=0.5,ja;q=0.4,es;q=0.3,it;q=0.2,pt;q=0.1,nl;q=0.1,sv;q=0.1'],
  ] as const) {
    assert.equal(environmentAcceptLanguage(parseEnvironment({ regional: { languages, locale: 'en-US', timeZone: 'UTC' } })), header);
  }
});

test('SDK resolves once and replays built-in locale calendars and fractional time zones in a real Realm', async () => {
  for (const preset of ['jp-ja-tokyo', 'np-ne-kathmandu', 'th-th-bangkok', 'ca-fr-toronto', 'au-en-lord-howe']) {
    const mimic = createMimic({ profilesRoot, profile, environment: { regional: { preset } } });
    try {
      const environment = mimic.environment!;
      assert.equal(environment.selection?.preset, preset);
      const job = { kind: 'run' as const, code: `({ language:navigator.language, intl:new Intl.DateTimeFormat().resolvedOptions(), text:new Date('2025-01-01T00:00:00Z').toLocaleString() })` };
      const first = await mimic.run(job);
      const second = await mimic.run(job);
      assert.ok(first.ok, JSON.stringify(first));
      assert.ok(second.ok, JSON.stringify(second));
      assert.equal(first.plan, second.plan);
      assert.deepEqual(first.value, {
        language: environment.regional.languages[0],
        intl: new Intl.DateTimeFormat(environment.regional.locale, { timeZone: environment.regional.timeZone }).resolvedOptions(),
        text: new Date('2025-01-01T00:00:00Z').toLocaleString(environment.regional.locale, { timeZone: environment.regional.timeZone }),
      });
    } finally { await mimic.close(); }
  }
});

test('shared workers apply regional defaults across Intl, locale methods and child Realms', async (t) => {
  const executor = new WorkerExecutor({ profilesRoot, size: 2, timeoutMs: 10_000 });
  t.after(() => executor.destroy());
  const code = `(() => {
    const date = new Date('2025-01-01T00:00:00Z');
    const iframe = document.createElement('iframe'); document.body.append(iframe);
    return {
      language: navigator.language, languages: navigator.languages,
      intl: ['DateTimeFormat', 'NumberFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'Segmenter']
        .map(name => new Intl[name]().resolvedOptions().locale),
      displayNames: new Intl.DisplayNames(undefined, {type:'region'}).resolvedOptions().locale,
      empty: new Intl.DateTimeFormat([]).resolvedOptions().locale,
      unsupported: new Intl.NumberFormat('zz-ZZ').resolvedOptions().locale,
      date: date.toLocaleString(), number: (123456.789).toLocaleString(), bigint: (123456n).toLocaleString(),
      lower: 'I'.toLocaleLowerCase(), upper: 'i'.toLocaleUpperCase(), compare: 'ä'.localeCompare('z'),
      explicit: new Intl.DateTimeFormat('de-DE', {timeZone:'UTC'}).resolvedOptions(),
      offsets: [date.getTimezoneOffset(), new Date('2025-07-01T00:00:00Z').getTimezoneOffset()],
      zone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      child: new iframe.contentWindow.Intl.DateTimeFormat().resolvedOptions().locale,
      shape: [Intl.NumberFormat.name, Intl.NumberFormat.length, Intl.NumberFormat.prototype.constructor === Intl.NumberFormat,
        Function.prototype.toString.call(Intl.NumberFormat), new Intl.NumberFormat() instanceof Intl.NumberFormat],
    };
  })()`;
  const turkey = parseEnvironment({ regional: { languages: ['tr-TR'], locale: 'tr-TR', timeZone: 'Europe/Istanbul' } });
  for (const environment of [japan, poland, turkey, japan]) {
    const results = await Promise.all([environment, poland].map((environment) => executor.run({
      profile, environment, job: { kind: 'run', code },
    })));
    for (const [index, result] of results.entries()) {
      assert.ok(result.ok, JSON.stringify(result));
      const regional = (index === 0 ? environment : poland).regional;
      const locale = regional.locale;
      let offsets = [-180, -180];
      if (locale === 'ja-JP') offsets = [-540, -540];
      else if (locale === 'pl-PL') offsets = [-60, -120];
      const intl = ['DateTimeFormat', 'NumberFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'Segmenter'] as const;
      assert.deepEqual(result.value, {
        language: regional.languages[0], languages: regional.languages,
        intl: intl.map((name) => (Reflect.construct(Intl[name], [locale]) as Intl.DateTimeFormat).resolvedOptions().locale),
        displayNames: new Intl.DisplayNames(locale, { type: 'region' }).resolvedOptions().locale,
        empty: locale,
        unsupported: new Intl.NumberFormat(locale).resolvedOptions().locale,
        date: new Date('2025-01-01T00:00:00Z').toLocaleString(locale, { timeZone: regional.timeZone }),
        number: (123456.789).toLocaleString(locale), bigint: (123456n).toLocaleString(locale),
        lower: 'I'.toLocaleLowerCase(locale), upper: 'i'.toLocaleUpperCase(locale), compare: 'ä'.localeCompare('z', locale),
        explicit: new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC' }).resolvedOptions(),
        offsets,
        zone: regional.timeZone, child: locale,
        shape: ['NumberFormat', 0, true, 'function NumberFormat() { [native code] }', true],
      });
    }
  }
  const original = await executor.run({ profile, job: { kind: 'run', code: 'navigator.language' } });
  assert.ok(original.ok);
  assert.equal(original.value, 'en-US');
});

test('capture pool forwards the environment per task without contaminating other captures', async (t) => {
  const pool = new CapturePool(2);
  t.after(() => pool.close());
  const results = await Promise.all([japan, poland].map((environment) => captureBodies({
    profile, profilesRoot, environment,
    pageUrl: 'https://regional.test/', pageHtml: '<!doctype html><body></body>',
    scriptUrl: 'https://regional.test/script.js',
    scriptSource: 'navigator.sendBeacon("/capture", JSON.stringify([navigator.language,new Intl.DateTimeFormat().resolvedOptions()]))',
    mode: 'bms', deadlineMs: 300, scriptTimeoutMs: 5000, maxPosts: 1,
  }, pool)));
  assert.deepEqual(results.map((result) => JSON.parse(result.bodies[0]!)), [japan, poland].map(({ regional }) => [
    regional.languages[0], new Intl.DateTimeFormat(regional.locale, { timeZone: regional.timeZone }).resolvedOptions(),
  ]));
});
