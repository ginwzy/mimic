import { BEHAVIOR_COVERAGE, CAPABILITY_ORIGINS, capabilitiesFromSupport, type Capability } from '../core/capabilities.js';
import type { SupportMap } from '../core/types.js';
import type { BuildContext, Feature } from '../shape/types.js';
import { deepFreeze, jsonCopy } from '../core/json.js';
import type { CapabilityClaims } from '../core/capabilities.js';

export function describeCapabilities(context: BuildContext, features: readonly Feature[], support: SupportMap): Record<string, Capability> {
  const entries = capabilitiesFromSupport(support);
  const owners = new Set<string>();
  const buildContext = Object.freeze(context);
  const levels = deepFreeze(support);
  // These names describe the Shape graph itself, not the behavior of installed methods.
  for (const name of Object.keys(context.shape.support)) {
    if ((name === 'structure' || name.endsWith('.shape')) && entries[name]!.legacy !== 'unsupported') {
      entries[name] = { ...entries[name]!, coverage: 'structure' };
    }
  }
  for (const feature of features) {
    const claims = jsonCopy(feature.describe?.call(undefined, buildContext, levels) ?? {}) as unknown as CapabilityClaims;
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new TypeError(`Invalid capability claims:${feature.id}`);
    for (const [name, claim] of Object.entries(claims)) {
      if (!Object.hasOwn(entries, name) || owners.has(name) || !claim
        || !CAPABILITY_ORIGINS.includes(claim.origin) || !BEHAVIOR_COVERAGE.includes(claim.coverage)
        || Object.keys(claim).some(key => key !== 'origin' && key !== 'coverage')) throw new TypeError(`Invalid or duplicate capability:${name}`);
      owners.add(name);
      entries[name] = { ...entries[name]!, ...claim };
    }
  }
  return entries;
}
