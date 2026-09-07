# Capability Semantics and Gates

## Contract

The default SDK remains run/capture/plan/list/close. Profile, Shape, Plan, Job and
Result remain v2. Existing SupportMap fields and require ordering are retained for
compatibility, not as a fidelity scale.

compileWithCapabilities returns `{ plan, capabilities }`. Application.inspect
provides the same output through the advanced application facade. The report has
revision capabilities-v1, a Plan ID, entries and its own canonical SHA-256 hash.
Changing only a description changes the report hash, not installation identity.
Reports are immutable declarations, not certificates of independently verified
browser behavior. Field presence is not proof of capture.

Each entry carries three independent values:

| Field | Values | Meaning |
| --- | --- | --- |
| origin | captured, derived, emulated, synthetic, mixed, unknown | Declared source of the described surface or identity |
| coverage | none, structure, constant, partial, complete, unknown | Behavior implemented within the named capability's scope |
| legacy | Existing Support value | Compatibility projection only |

Structure means the interface graph only. Constant means fixed identity/value
replay, not the computation that a browser would use to obtain it. Partial means
only a subset of the named API is implemented. Complete requires the whole named
contract; no current built-in declaration uses it. Unknown means unreviewed or
unavailable evidence, not success. These categories are not an ordinal scale.

Feature.describe owns behavior claims. A custom Feature without this optional
callback still compiles: legacy labels remain intact and behavior is not inferred
from captured/derived/emulated. Shape structure keys describe graph coverage only.
Invalid, duplicate or undeclared claim keys fail compilation.

## Scope

- canvas.fingerprint describes the default PNG identity value. Other supported
  MIME requests use synthetic identity payloads, even when PNG was supplied.
- canvas.2d/canvas.runtime are partial interfaces, not raster rendering. Synthetic
  data URLs carry hash payloads, not valid rendered images.
- audio.sums/audio.data are a four-number identity tuple; audio.samples are
  synthetic arrays consistent with those sums, not captured waveforms.
- globals.system-colors describes a resolved palette. A partly supplied palette
  is mixed; absence is synthetic. A complete supplied palette has unknown origin
  because v2 has no per-section systemColors evidence. Its old label is retained.
- Navigator/WebGL data claims describe supplied values, not full API fidelity.
  Disabled WebGL retains structure only; disabled net/trace modes retain none.

## Requirements

New requirements accept explicit sets for either dimension. An absent capability
fails; an empty or invalid accepted set is an error. A captured constant cannot
satisfy a complete behavior requirement. Old require ranking remains isolated in
meetsLegacySupport and must not be reused for new capability checks.

```ts
import { createNodeApplication } from 'mimic/advanced';

const app = createNodeApplication();
const request = {
  profile: '<fp-env-id>',
  job: { kind: 'run' as const, code: 'document.createElement("canvas").toDataURL()' },
};
const { plan, capabilities } = await app.inspect(request, {
  'canvas.fingerprint': { coverage: ['constant'], origins: ['synthetic', 'captured', 'derived'] },
});
const result = await app.executePrepared(request, plan);
```

Direct compiler callers can use CompileInput.requireCapabilities. Existing
reports can be checked with assertCapabilities. No new field is inserted into
public Job/Result JSON, and the default SDK does not implicitly enforce these
advanced requirements. Keep the checked request and Plan together for execution.

## Identity Migration

environment/identity.ts owns the legacy-identity-v1 Canvas, Audio and system-color
fallback policy. Ordinary API argument defaults and method emulation remain with
their Drivers. Compiled Audio tuples and palettes retain their previous values.
Canvas now binds PNG/JPEG/WebP values up front; its Driver only selects a value.

Canvas Feature rev 2 -> 3 and Engine ABI v2.10 -> v2.11 are intentional. All corpus
Plan IDs change with the catalog/engine identities and Canvas bind format. Old
Plans fail the Engine manifest check and must be recompiled. Profile/Shape data
and legacy support are unchanged. Because the R5 interaction seed includes the
Plan ID, regenerated Plans also change default interaction trajectories; this is
not hidden by rewriting the seed rule. The interaction completion contract stays
the same, but full execution identity is still not represented by Plan ID alone.

## Verification

```sh
npm test
npm run check
npm run gate:capabilities
npm run gate:leak -- '{"profile":"<fp-env-id>"}'
npm run gate:memory -- '{"profile":"<fp-env-id>"}'
```

The capability gate checks both job modes across the full corpus: every built-in
behavior is classified and legacy projection is unchanged. It does not prove
browser fidelity; execution/oracle tests remain separate.

Replace `<fp-env-id>` with an ID listed from the local raw fp-env cache. Generated
Legacy Profiles are no longer distributed. An empty production cache makes the
capability gate fail; a data syntax check with zero Profiles is not corpus evidence.

The resource gate uses the production executor to check cleanup and natural child
exit. The memory observer runs separate local and worker child processes with
the actual TaskRunner/Engine. Its quality-only worker has no production queue or
watchdog, and introduces no diagnostics into the production protocol.

By default each mode warms up with 20 jobs, then executes 300 iframe/OffscreenCanvas
jobs, sampling every 50. Both isolates force GC across event-loop turns. Samples
include heapUsed, heapTotal, external, arrayBuffers, V8 malloced_memory and
total_physical_size. RSS is process-wide and is not added once per isolate.
ArrayBuffers is a subset of external. These counters do not fully attribute OS or
native allocator residency, and forced-GC observations are not production latency
or no-GC memory guarantees.

Memory status is observed without budgets. Explicit budgets measure the maximum
sampled post-warmup growth, independently for RSS and each isolate's heapUsed:

```sh
# Diagnostic enforcement example: zero growth is expected to fail, not a recommended budget.
node dist/src/quality/memory.js '{"profile":"<fp-env-id>","tasks":20,"warmup":5,"sampleEvery":10,"rssBudgetMiB":0,"heapBudgetMiB":0}'
```

A budget failure returns JSON with failed checks and exits nonzero. Unknown options,
invalid budgets, workload errors and child timeouts also fail. A configured gate
only covers the supplied budgets; it is not an unqualified memory-stability claim.
Calibrate operational limits for the intended Node version, host and workload.
Current RSS growth remains unresolved; do not raise budgets simply to mark it green.
