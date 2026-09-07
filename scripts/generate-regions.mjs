import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cldr = '48.0.0';
const tzdb = '2026c';
const cldrRoot = `https://raw.githubusercontent.com/unicode-org/cldr-json/${cldr}/cldr-json/cldr-core/`;
const sources = {
  'availableLocales.json': {
    url: `${cldrRoot}availableLocales.json`,
    sha256: '2961ccc06b437a732c689ad59e891b563e6618546b4c4cda7216549d8a0b4528',
  },
  'territoryInfo.json': {
    url: `${cldrRoot}supplemental/territoryInfo.json`,
    sha256: 'b50369a0e1f5434c942dfe45064b39f488604ca0cedac5117e993248c19f2c0a',
  },
  'likelySubtags.json': {
    url: `${cldrRoot}supplemental/likelySubtags.json`,
    sha256: '38345946ad457213fb39e9645ab50f36b61681bf674b2eef2979a3b58d04afc8',
  },
  'zone.tab': {
    url: `https://raw.githubusercontent.com/eggert/tz/${tzdb}/zone.tab`,
    sha256: '7cc78ea166261b3dedf951cdd721051460851e6fcd96c12b8e3194cf25677f21',
  },
};
const args = process.argv.slice(2);
const check = args.includes('--check');
const inputIndex = args.indexOf('--input');
const input = inputIndex < 0 ? undefined : args[inputIndex + 1];
const missingInput = inputIndex >= 0 && (!input || input.startsWith('--'));
const unknownArgument = args.some((arg, index) => arg !== '--check' && arg !== '--input'
  && (inputIndex < 0 || index !== inputIndex + 1));
if (missingInput || unknownArgument) {
  throw new Error('usage: node scripts/generate-regions.mjs [--check] [--input <offline-source-directory>]');
}

const texts = {};
const provenance = {};
for (const [name, { url, sha256: expectedHash }] of Object.entries(sources)) {
  let text;
  if (input) text = await readFile(path.join(input, name), 'utf8');
  else {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    text = await response.text();
  }
  const sha256 = createHash('sha256').update(text).digest('hex');
  if (sha256 !== expectedHash) throw new Error(`Source checksum mismatch: ${name}`);
  texts[name] = text;
  provenance[name] = { url, sha256 };
}
const available = JSON.parse(texts['availableLocales.json']).availableLocales.full;
const territories = JSON.parse(texts['territoryInfo.json']).supplemental.territoryInfo;
const likely = JSON.parse(texts['likelySubtags.json']).supplemental.likelySubtags;

// Use the pinned CLDR mappings, not the generator host's ICU likely-subtag data.
function maximize(tag) {
  const value = new Intl.Locale(tag.replaceAll('_', '-'));
  if (!value.language) return undefined;
  const fallback = likely[value.baseName] ?? likely[[value.language, value.script].filter(Boolean).join('-')]
    ?? likely[[value.language, value.region].filter(Boolean).join('-')] ?? likely[value.language];
  if (!fallback) return undefined;
  const full = new Intl.Locale(fallback);
  return { language: value.language, script: value.script ?? full.script };
}
const translated = new Set(available.map(maximize).filter(Boolean).map(({ language, script }) => `${language}-${script}`));
const zones = new Map();
for (const line of texts['zone.tab'].split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [country, coordinates, timeZone] = line.split('\t');
  if (!/^[A-Z]{2}$/.test(country) || !coordinates || !timeZone?.includes('/')) throw new Error(`Invalid zone.tab row: ${line}`);
  const entries = zones.get(country) ?? [];
  entries.push(timeZone);
  zones.set(country, entries);
}
const rows = [];
const excludedCountries = [];
const omittedRegionalLanguages = [];
for (const [country, timeZones] of [...zones].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  const population = territories[country]?.languagePopulation ?? {};
  const entries = Object.entries(population).filter(([, info]) => Number(info._populationPercent) > 0);
  const official = entries.filter(([, info]) => info._officialStatus);
  // Where CLDR has no official language, retain its most widely used recorded language.
  const candidates = official.length ? official : entries.sort((a, b) => Number(b[1]._populationPercent) - Number(a[1]._populationPercent)).slice(0, 1);
  const locales = new Set();
  for (const [language, info] of candidates) {
    if (timeZones.length > 1 && info._officialStatus === 'official_regional') {
      omittedRegionalLanguages.push(`${country}:${language}`);
      continue;
    }
    const full = maximize(language);
    if (!full || !translated.has(`${full.language}-${full.script}`)) continue;
    const defaultScript = maximize(full.language)?.script;
    const tag = [full.language, full.script === defaultScript ? undefined : full.script, country].filter(Boolean).join('-');
    locales.add(tag);
  }
  if (!locales.size) excludedCountries.push(country);
  for (const locale of [...locales].sort()) {
    const language = locale.slice(0, -(country.length + 1)).toLowerCase();
    for (const timeZone of [...timeZones].sort()) {
      const city = timeZone.split('/').slice(1).join('-').replaceAll('_', '-').toLowerCase();
      rows.push([`${country.toLowerCase()}-${language}-${city}`, country, locale, timeZone]);
    }
  }
}
rows.sort(([leftId], [rightId]) => {
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
});
if (!rows.length || new Set(rows.map(([id]) => id)).size !== rows.length) throw new Error('Empty or duplicate region catalog');
const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const metadata = {
  version: `cldr-${cldr}-tzdb-${tzdb}-v1`, hash, cldr, tzdb,
  evidence: 'derived', rule: 'cldr-official-language-country-timezone-v1',
  sourceLocaleCount: available.length, sourceTerritoryCount: Object.keys(territories).length,
  presetCount: rows.length, countryCount: new Set(rows.map((row) => row[1])).size,
  excludedCountries, omittedRegionalLanguages: omittedRegionalLanguages.sort(), sources: provenance,
};
const content = '// Generated by scripts/generate-regions.mjs; do not edit. See NOTICE for data licenses.\n'
  + `export const regionDataVersion = ${JSON.stringify(metadata, null, 2)} as const;\n\n`
  + '// Each tuple is [id, country, locale, timeZone]. Language preferences are derived, not sampled.\n'
  + 'export const regionData: readonly (readonly [string, string, string, string])[] = [\n'
  + rows.map((row) => `  ${JSON.stringify(row)},`).join('\n') + '\n];\n';
const output = path.join(root, 'src/core/regions.data.ts');
if (check) {
  if (await readFile(output, 'utf8') !== content) throw new Error('Regional catalog is stale; regenerate it');
} else await writeFile(output, content);
console.log(JSON.stringify({ ...metadata, sources: undefined, omittedRegionalLanguages: omittedRegionalLanguages.length }));
