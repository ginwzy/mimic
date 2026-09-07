import { createHash, randomBytes } from 'node:crypto';
import { MimicError } from './error.js';
import { deepFreeze } from './json.js';
import { parseProfile } from './parse.js';
import { digest, seal } from './seal.js';
import { listRegions, regionalCatalog, regionalRuntime, type RegionPreset } from './regions.js';
import type { EnvironmentOptions, Profile, RegionalSelection, ResolvedEnvironment, Source } from './types.js';

const RULE = 'regional-environment-v1';

function object(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new TypeError(`${name} must be an object containing only ${keys.join(', ')}`);
  }
  return value as Record<string, unknown>;
}

function locale(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a locale tag`);
  const canonical = Intl.getCanonicalLocales(value)[0]!;
  if (Intl.DateTimeFormat.supportedLocalesOf([canonical]).length === 0) {
    throw new RangeError(`${name} is not supported: ${value}`);
  }
  return canonical;
}

export function parseEnvironmentOptions(input: unknown): EnvironmentOptions {
  try {
    const environment = object(input, ['regional', 'selection'], 'environment');
    const candidate = object(environment.regional, ['preset', 'random', 'countries', 'seed', 'languages', 'locale', 'timeZone'], 'environment.regional');
    if ('preset' in candidate || 'random' in candidate) {
      if (environment.selection !== undefined) throw new TypeError('selection requires a resolved regional environment');
      if ('preset' in candidate) {
        object(candidate, ['preset'], 'environment.regional');
        if (typeof candidate.preset !== 'string' || !listRegions({ supportedOnly: false }).some(({ id }) => id === candidate.preset)) {
          throw new RangeError(`Unknown regional preset: ${String(candidate.preset)}`);
        }
        return deepFreeze({ regional: { preset: candidate.preset } });
      }
      object(candidate, ['random', 'countries', 'seed'], 'environment.regional');
      if (candidate.random !== true) throw new TypeError('environment.regional.random must be true');
      const countries = candidate.countries === undefined ? undefined : countryList(candidate.countries);
      if (candidate.seed !== undefined && (typeof candidate.seed !== 'string' || !candidate.seed.length)) {
        throw new TypeError('environment.regional.seed must be a non-empty string');
      }
      return deepFreeze({ regional: { random: true,
        ...(countries === undefined ? {} : { countries }),
        ...(candidate.seed === undefined ? {} : { seed: candidate.seed }),
      } });
    }
    const regional = object(environment.regional, ['languages', 'locale', 'timeZone'], 'environment.regional');
    if (!Array.isArray(regional.languages) || regional.languages.length === 0) {
      throw new TypeError('environment.regional.languages must be a non-empty locale list');
    }
    const languages = regional.languages.map((value) => locale(value, 'environment.regional.languages'));
    if (new Set(languages).size !== languages.length) throw new TypeError('environment.regional.languages contains duplicates');
    const defaultLocale = locale(regional.locale, 'environment.regional.locale');
    if (typeof regional.timeZone !== 'string' || !regional.timeZone || /^[+-]/.test(regional.timeZone)) {
      throw new TypeError('environment.regional.timeZone must be an IANA time zone');
    }
    const timeZone = new Intl.DateTimeFormat('en-US', { timeZone: regional.timeZone }).resolvedOptions().timeZone;
    const resolved: ResolvedEnvironment = { regional: { languages, locale: defaultLocale, timeZone } };
    if (environment.selection !== undefined) {
      const selection = object(environment.selection, ['preset', 'country', 'catalog', 'catalogHash', 'runtime', 'seed', 'countries'], 'environment.selection');
      const preset = listRegions({ supportedOnly: false }).find(({ id }) => id === selection.preset);
      if (!preset?.supported || selection.country !== preset.country || selection.catalog !== regionalCatalog.version
        || selection.catalogHash !== regionalCatalog.hash || selection.runtime !== regionalRuntime
        || preset.locale !== defaultLocale || languages.length !== 1 || languages[0] !== preset.locale
        || new Intl.DateTimeFormat('en-US', { timeZone: preset.timeZone }).resolvedOptions().timeZone !== timeZone) {
        throw new TypeError('environment.selection does not match the regional preset or catalog version');
      }
      if (selection.seed !== undefined && (typeof selection.seed !== 'string' || !selection.seed)) throw new TypeError('Invalid selection seed');
      const countries = selection.countries === undefined ? undefined : countryList(selection.countries);
      if (countries && !countries.includes(preset.country)) throw new TypeError('Selected preset is outside selection countries');
      resolved.selection = { ...selection, ...(countries === undefined ? {} : { countries }) } as unknown as RegionalSelection;
    }
    return deepFreeze(resolved);
  } catch (cause) {
    throw new MimicError({
      phase: 'parse', code: 'BAD_PROFILE',
      message: `Invalid environment: ${cause instanceof Error ? cause.message : String(cause)}`, cause,
    });
  }
}

function countryList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.some((country) => typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country))) {
    throw new TypeError('countries must be a non-empty list of two-letter country codes');
  }
  const countries = [...new Set(value.map((country: string) => country.toUpperCase()))].sort();
  const known = new Set(listRegions({ supportedOnly: false }).map(({ country }) => country));
  for (const country of countries) if (!known.has(country)) throw new RangeError(`No regional data for country: ${country}`);
  return countries;
}

export function resolveEnvironment(input: unknown): ResolvedEnvironment {
  const options = parseEnvironmentOptions(input);
  if ('languages' in options.regional) return options as ResolvedEnvironment;
  const regional = options.regional;
  const random = 'random' in regional ? regional : undefined;
  const seed = random === undefined ? undefined : random.seed ?? randomBytes(16).toString('hex');
  const candidates = listRegions(random?.countries === undefined ? {} : { countries: random.countries });
  function pick<T>(values: readonly T[], label: string): T {
    // Rejection sampling keeps country/preset selection uniform without mutable PRNG state.
    const ceiling = Math.floor(0x1_0000_0000 / values.length) * values.length;
    for (let attempt = 0; ; attempt += 1) {
      const value = createHash('sha256').update(JSON.stringify([regionalCatalog.hash, seed, label, attempt])).digest().readUInt32BE(0);
      if (value < ceiling) return values[value % values.length]!;
    }
  }
  if (!candidates.length) throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: 'No regional presets supported by this runtime in the requested countries' });
  const countries = [...new Set(candidates.map(({ country }) => country))].sort();
  let preset: RegionPreset | undefined;
  if ('preset' in regional) {
    preset = candidates.find(({ id }) => id === regional.preset);
  } else {
    const country = pick(countries, 'country');
    preset = pick(candidates.filter((preset) => preset.country === country), `preset:${country}`);
  }
  if (!preset) throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `Regional preset is unsupported by this runtime: ${'preset' in regional ? regional.preset : ''}` });
  const selection: RegionalSelection = {
    preset: preset.id, country: preset.country, catalog: regionalCatalog.version,
    catalogHash: regionalCatalog.hash, runtime: regionalRuntime,
  };
  if (seed !== undefined) {
    selection.seed = seed;
    selection.countries = random?.countries ?? countries;
  }
  return parseEnvironmentOptions({
    regional: { languages: preset.languages, locale: preset.locale, timeZone: preset.timeZone },
    selection,
  }) as ResolvedEnvironment;
}

export { resolveEnvironment as parseEnvironment };

// The required legacy offset is a deterministic snapshot at Unix epoch, not a DST rule.
function epochOffset(timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(0);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return -Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second)) / 60_000;
}

export function regionalProfile(profile: Profile, environment: ResolvedEnvironment): Profile {
  const { hash: _hash, ...body } = profile;
  const { languages, locale, timeZone } = environment.regional;
  const base = { id: profile.id, hash: profile.hash };
  const source: Source = { kind: 'derived', rule: RULE, base, hash: digest({ rule: RULE, base, environment }) };
  return parseProfile(seal({
    ...body,
    source,
    navigator: { ...profile.navigator, language: languages[0]!, languages: [...languages] },
    locale,
    timezone: { timeZone, offset: epochOffset(timeZone) },
    evidence: {
      ...profile.evidence,
      navigator: {
        ...profile.evidence.navigator,
        support: 'derived',
        fields: { ...profile.evidence.navigator.fields, language: 'derived', languages: 'derived' },
      },
      timezone: { support: 'derived', fields: { timeZone: 'derived', offset: 'derived' }, source },
    },
  }));
}

export function environmentAcceptLanguage(environment: ResolvedEnvironment): string {
  const { languages } = environment.regional;
  const expanded = new Set<string>();
  for (const [index, language] of languages.entries()) {
    expanded.add(language);
    const base = language.split('-')[0]!;
    if (base.length > 1 && (index === languages.length - 1 || languages[index + 1]!.split('-')[0] !== base)) expanded.add(base);
  }
  return [...expanded].map((language, index) => index === 0 ? language
    : `${language};q=0.${Math.max(1, 10 - index)}`).join(',');
}
