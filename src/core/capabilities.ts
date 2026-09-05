import { MimicError } from './error.js';
import { deepFreeze } from './json.js';
import { digest } from './seal.js';
import type { JsonValue, Support, SupportMap } from './types.js';

export const CAPABILITY_ORIGINS = ['captured', 'derived', 'emulated', 'synthetic', 'mixed', 'unknown'] as const;
export const BEHAVIOR_COVERAGE = ['none', 'structure', 'constant', 'partial', 'complete', 'unknown'] as const;
export type CapabilityOrigin = typeof CAPABILITY_ORIGINS[number];
export type BehaviorCoverage = typeof BEHAVIOR_COVERAGE[number];
export interface CapabilityClaim {
  readonly origin: CapabilityOrigin;
  readonly coverage: BehaviorCoverage;
}
export interface Capability extends CapabilityClaim {
  /** Lossy v2 label, retained for existing clients; not a behavior ranking. */
  readonly legacy: Support;
}
export type CapabilityClaims = Readonly<Record<string, CapabilityClaim>>;
export interface CapabilityReport {
  readonly revision: 'capabilities-v1';
  readonly plan: string;
  readonly entries: Readonly<Record<string, Capability>>;
  readonly hash: string;
}
export type CapabilityRequirements = Readonly<Record<string, {
  readonly origins?: readonly CapabilityOrigin[];
  readonly coverage?: readonly BehaviorCoverage[];
}>>;

export function legacyOrigin(level: Support): CapabilityOrigin {
  return level === 'captured' || level === 'derived' || level === 'emulated' ? level : 'unknown';
}

/** Only reviewed claims establish behavior. A captured value alone establishes none. */
export function capabilitiesFromSupport(support: Readonly<SupportMap>): Record<string, Capability> {
  return Object.fromEntries(Object.entries(support).map(([name, legacy]) => [name, {
    legacy, origin: legacyOrigin(legacy),
    coverage: legacy === 'unsupported' ? 'none' : legacy === 'shape-only' ? 'structure' : 'unknown',
  }]));
}

export function projectSupport(entries: Readonly<Record<string, Capability>>): SupportMap {
  return Object.fromEntries(Object.entries(entries).map(([name, item]) => [name, item.legacy]));
}

export function capabilityReport(plan: string, entries: Readonly<Record<string, Capability>>): CapabilityReport {
  const body = { revision: 'capabilities-v1' as const, plan, entries };
  return deepFreeze({ ...body, hash: digest(body as unknown as JsonValue) });
}

export function assertCapabilities(report: CapabilityReport, requirements: CapabilityRequirements): void {
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) throw new TypeError('Invalid capability requirements');
  for (const [name, required] of Object.entries(requirements)) {
    if (!required || typeof required !== 'object' || Array.isArray(required)
      || Object.keys(required).some(key => key !== 'origins' && key !== 'coverage')
      || (required.origins === undefined && required.coverage === undefined)) throw new TypeError(`Invalid capability requirement:${name}`);
    for (const [values, allowed] of [[required.origins, CAPABILITY_ORIGINS], [required.coverage, BEHAVIOR_COVERAGE]] as const) {
      if (values !== undefined && (!Array.isArray(values) || !values.length || values.some(value => !(allowed as readonly string[]).includes(value)))) {
        throw new TypeError(`Invalid capability requirement:${name}`);
      }
    }
    const actual = Object.hasOwn(report.entries, name) ? report.entries[name] : undefined;
    if (!actual || (required.origins && !required.origins.includes(actual.origin))
      || (required.coverage && !required.coverage.includes(actual.coverage))) {
      throw new MimicError({ phase: 'compile', code: 'LOW_SUPPORT', message: `Capability requirement failed:${name}`,
        details: { name, required, actual: actual ?? null } as unknown as JsonValue });
    }
  }
}

/** Compatibility only: never use this ordinal as a coverage comparison. */
export function meetsLegacySupport(actual: Support, minimum: Support): boolean {
  const rank: Record<Support, number> = { unsupported: 0, 'shape-only': 1, emulated: 2, derived: 3, captured: 4 };
  return rank[actual] >= rank[minimum];
}
