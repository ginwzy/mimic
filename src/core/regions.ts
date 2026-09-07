import { deepFreeze } from './json.js';
import { regionData, regionDataVersion } from './regions.data.js';
import type { RegionalEnvironment } from './types.js';

export interface RegionPreset extends RegionalEnvironment {
  readonly id: string;
  readonly country: string;
  readonly evidence: 'derived';
  readonly supported: boolean;
  readonly unsupported: readonly string[];
}

export interface RegionFilter {
  readonly countries?: readonly string[];
  readonly supportedOnly?: boolean;
}

export const regionalCatalog = deepFreeze(regionDataVersion);
export const regionalRuntime = `icu-${process.versions.icu ?? 'unknown'}-cldr-${process.versions.cldr ?? 'unknown'}-tz-${process.versions.tz ?? 'unknown'}`;
let presets: readonly RegionPreset[] | undefined;

function buildPresets(): readonly RegionPreset[] {
  const localeIssues = new Map<string, string[]>();
  const timeZoneSupport = new Map<string, boolean>();
  return deepFreeze(regionData.map(([id, country, locale, timeZone]) => {
    let issues = localeIssues.get(locale);
    if (!issues) {
      issues = [];
      for (const name of ['DateTimeFormat', 'NumberFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'DisplayNames', 'Segmenter'] as const) {
        const constructor: { supportedLocalesOf(locales: string[]): string[] } | undefined = Intl[name];
        if (!constructor || !constructor.supportedLocalesOf([locale]).length) issues.push(`Intl.${name}:${locale}`);
      }
      localeIssues.set(locale, issues);
    }
    if (!timeZoneSupport.has(timeZone)) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone });
        timeZoneSupport.set(timeZone, true);
      } catch {
        timeZoneSupport.set(timeZone, false);
      }
    }
    const unsupported = [...issues, ...(timeZoneSupport.get(timeZone) ? [] : [`timeZone:${timeZone}`])];
    return { id, country, locale, timeZone, languages: [locale], evidence: 'derived' as const, supported: unsupported.length === 0, unsupported };
  }));
}

export function listRegions(filter: RegionFilter = {}): readonly RegionPreset[] {
  presets ??= buildPresets();
  return presets.filter((preset) => (filter.supportedOnly === false || preset.supported)
    && (filter.countries === undefined || filter.countries.includes(preset.country)));
}
