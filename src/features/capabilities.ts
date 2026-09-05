import { legacyOrigin, type BehaviorCoverage, type CapabilityClaims, type CapabilityOrigin } from '../core/capabilities.js';
import type { SupportMap } from '../core/types.js';

/** Reviewed, feature-local scopes; unsupported modes do not inherit enabled-mode claims. */
export function describeCoverage(
  support: Readonly<SupportMap>, coverage: Readonly<Record<string, BehaviorCoverage>>,
  origins: Readonly<Record<string, CapabilityOrigin>> = {},
): CapabilityClaims {
  return Object.fromEntries(Object.entries(coverage).filter(([name]) => Object.hasOwn(support, name)).map(([name, behavior]) => [name, {
    origin: origins[name] ?? legacyOrigin(support[name]!),
    coverage: support[name] === 'unsupported' ? 'none' : behavior,
  }]));
}
