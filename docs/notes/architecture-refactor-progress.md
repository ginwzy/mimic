# Architecture Refactor Progress

Contract: [architecture-refactor.md](../spec/architecture-refactor.md)

## Status

| Stage | Status | Evidence / Next Action |
| --- | --- | --- |
| R0: Baseline | Complete | 237/237 tests; typecheck and check passed. |
| R1: Planning/execution | Complete | 238/238 tests; actual list/plan/run/close and import hooks verified. |
| R2: Resource ownership | Complete | 240/240 tests; cleanup gate passed; RSS growth remains under observation. |
| R3: Features | Complete | 247/247 tests; 13 Shapes and 2026 Plans unchanged; independent load boundaries verified. |
| R4: Normalization | Complete | 251/251 tests; corpus/report/error equality; new-format store/rebuild/run without Legacy. |
| R5: Contracts/policies | Complete | 256/256 tests; typed capture/session/policy; 22 Results and 2026 Plans unchanged. |
| R6: Capabilities/gates | Complete | 263/263 tests; 2026-Plan capability gate; explicit ABI migration; RSS remains unresolved. |

## Baseline Evidence

Previous analysis on Node 24.12.0: check passed; tests 233/237 passed.
Failures: two stale corpus-count assertions (1012 vs 1013), invalid navigator
error precedence, and Notification static members in the macOS Chrome 149 probe.
These results must be reproduced before changing expectations.

The starting worktree was clean. A direct SDK observation confirmed constructor
and list-only use created one worker.

## Work Log

- Recorded the accepted objective, stages, compatibility constraints and
  verification policy. Starting R0.
- R0 reproduced all four failures in /tmp/mimic-refactor-baseline.log. Inventory
  confirms the added Android Chrome 145 profile: 1013 profiles, 13 Shapes,
  1007 fp-env sources and 1000 Pages. Updated the inventory assertion and made
  Plan uniqueness relative to the enumerated corpus.
- R0 moved required identity checks before target derivation. Added Notification
  requestPermission/maxActions through chrome Feature revision 3. Member presence
  follows the captured baseline; permission/default and maxActions=2 remain
  emulated behavior, not new captured evidence. No Shape or baseline rewrites.
- R0 verification: /tmp/mimic-refactor-r0-tests.log (237 passed),
  /tmp/mimic-refactor-r0-check.log (typecheck/build/shapes/data passed).
- R1 extracted app/planner.ts and runtime/runner.ts; Application now composes
  them. Node planning uses a manifest without creating a JsdomEngine. Introduced
  an injected WorkerPool with a shared wire protocol and lazy worker creation;
  WorkerExecutor remains the published Node convenience facade.
- R1 verification: /tmp/mimic-refactor-r1-final-tests.log (238 passed), typecheck
  passed. Node load hooks observed no runner, interaction model or JsdomEngine
  implementation during SDK list/plan. Worker counts: planned=0, executed=1,
  closed=0; execution returned 42 with the planned ID. Existing SDK/direct
  equivalence, HTTP, queue, watchdog, oracle and package tests passed.
- R1 intentional contract change: initial worker count is zero rather than one.
  Updated that assertion and added a list/plan/run/close integration contract.
  Capture options still fail at construction via a pure shared validator.
- R2 reproduction: two live runtimes plus an unavailable second document caused
  its OffscreenCanvas fallback to reach the first Realm; the foreign-object guard
  then rejected the result. The module-level factory is the suspected causal
  path, not evidence of a successful object escape.
- R2 added ExecutionSession with optional per-task Driver sessions. The DOM
  fallback factory is now a session closure, cleared on task disposal. Network
  and trace report reduction lives in those Drivers rather than JsdomEngine.
  jsdom internal hooks moved to engine/jsdom-compat.ts. Cleanup continues even
  if restoring the window.close descriptor or closing a Realm instance fails.
- R2 intentionally advances Engine ABI from mimic-jsdom-v2.9 to v2.10; old Plans
  must not silently run under changed driver lifecycle semantics. Profile/Shape
  artifacts, baseline data and v2 wire schema remain unchanged.
- R2 verification: /tmp/mimic-refactor-r2-final-tests.log (240 passed),
  /tmp/mimic-refactor-r2-check.log (typecheck/build/shapes/data passed),
  /tmp/mimic-refactor-r2-leak.json (passed; child naturally exited; 0 live workers,
  0 active runtimes). The first extra observation overlapped a rebuilding dist/
  and was invalid due to missing assets; repeated after build completion.
- R2 sustained observation: /tmp/mimic-refactor-r2-memory.json. Ran 300 in-process
  and 300 worker jobs using iframe + OffscreenCanvas, sampling every 50 jobs with
  main-thread GC. Every job returned 8; engine active=0 at all samples; one worker
  reused throughout and terminated at close. Main heapUsed ranged 51.0-57.3 MiB,
  but process RSS rose from 1078 to 1783 MiB. Worker isolate heap was not sampled;
  this does NOT establish an RSS plateau or isolate the remaining source.
- Final R0-R2 checkpoint: /tmp/mimic-refactor-final-tests.log (240/240 passed,
  0 skipped), /tmp/mimic-refactor-final-check.log (typecheck/build/shapes/data
  passed), git diff --check passed. Architecture spec synchronized. No commits
  created; changes remain in the worktree for review.

## Next Increment

R6 is next: separate evidence origin from behavior coverage, retain the existing
SupportMap as a compatibility projection, and centralize versioned fallback identity
policy currently owned by runtime Drivers. Extend capability/dependency gates and
repeatable long-run validation; do not equate cleanup success with RSS stability.
Any wire/identity changes require an explicit schema/revision/ABI decision. R6 is
planned, not implemented.

## R3 Work Log

R3 started with the R0-R2 worktree intact. An additional user edit in flow/run.ts
is outside this stage and will be preserved. Recursive Chrome application also
normalizes Document key order after DOM exists; removing recursion must preserve
that finalization explicitly, not just delete calls.

R3 increment 1: Screen pilot passed both runtime tests and typecheck. Split all 16
Features into *.compile.ts and *.driver.ts, retaining only actual shared protocol
constants/pure functions in *.shared.ts. Planning uses features/compile.ts and
driver IDs; runtime uses features/drivers.ts. Removed unpublished mixed facades
and migrated imports. 2026 run/capture Plans across 1013 Profiles match the
pre-refactor IDs and operation digests byte-for-byte (/tmp/mimic-r3-before.json,
/tmp/mimic-r3-split-identities.json). Initial suite: 238 passed; two import-graph
tests still named the removed index.ts, now migrated and extended bidirectionally.

R3 increment 2: Replaced recursive Shape builder calls with centralized dependency
resolution in features/shape.ts. Feature.requires remains the executable dependency
source; the Chrome host contribution and post-Touch support order are explicit
composition rules. Chrome Document key-order finalization now runs after all
contributions. Individual *.shape.ts modules no longer import one another.

Moved deferred DOM ownership into Navigator/Network Feature declarations. Shared
shape/writes.ts now defines write identity for composition conflicts, generic DOM
wrapping and Plan graph validation. Added regression contracts for dependency
selection, repeated composition, callable aliases, reserved members and registry
alignment; added bidirectional import checks and a no-recursive-Shape check.

Verification before final checkpoint: 246/246 tests passed; npm run check passed.
All 13 regenerated Shape files and manifest are byte-identical. All 2026 corpus
Plan IDs and operation digests match the baseline (/tmp/mimic-r3-after.json).
No Feature revision, Engine ABI, schema or captured evidence changed in R3.

Independent Node load hooks rejected runtime imports during actual SDK list/plan
and rejected Feature compilation during TaskRunner run/capture. Planning listed
1013 Profiles and created zero workers; execution returned iframe/OffscreenCanvas
data and captured {"value":42}. Evidence: /tmp/mimic-r3-plan-boundary.json and
/tmp/mimic-r3-execute-boundary.json. The observation script initially read the
wrong result field (body instead of captured); corrected against the existing
Runner contract without changing production behavior.

Resource gate /tmp/mimic-r3-leak.json passed: child naturally exited; zero active
Runtimes, queued jobs and live workers at close. RSS delta was about 662 MiB,
so the earlier memory risk remains open. No supplier endpoints were contacted.

Final R3 checkpoint: /tmp/mimic-r3-final-tests.log (247/247 passed, 0 skipped),
/tmp/mimic-r3-final-check.log (typecheck/build/Shape/data passed), git diff --check
passed. The architecture spec now documents the new entry points and ownership
rules. No dependency changes, generated baseline rewrites or commits were made.
The pre-existing flow/run.ts edit remains untouched.

## R4 Work Log

R4 increment 1: Moved identity defaults/evidence classification and Profile/Page
construction to profiles/normalize.ts. Its input explicitly supplies identity
facts, page context, source, target, Shape, captured sections and derived fields;
it has no format metadata, file lookup, inheritance or migration-report input.
Browser-section extraction, target evidence and Shape resolution are separate
modules. The shared report module preserves existing ledger paths and rejection
of unmapped fields; compatibility report metadata is not fed to normalization.

Legacy retains name checks, inheritance, origins and storage. Collect derives
identity directly from capture facts. The fp-env adapter is now profiles/fp-env.ts
and no longer imports Legacy; published advanced/index exports remain available.

First verification: 247/247 existing tests passed (/tmp/mimic-r4-first-tests.log).
Compared full serialized outputs, report digests and Profile/Page/Shape hashes
before and after for 1013 Legacy records, 3 real Collect fixtures and 2 fp-env
fixture variants (/tmp/mimic-r4-before.json, /tmp/mimic-r4-after.json): identical.
The local _fp-env raw cache is absent; direct raw import is validated using the
existing fp-env test fixture, not claimed as a full raw-cache verification.
22 invalid-input cases retain the same error phase, code and message, including
combined name/identity/traits/field failures (/tmp/mimic-r4-errors-*.json).

R4 increment 2: Added core input/immutability/derived-evidence contracts and
dependency checks. A fresh Node process rejected every legacy/ module load while
normalizing fp-env, appending 3 captures (including repeated identical writes),
loading ProfileFiles, rebuilding all artifacts and running 4 imported identities
through Planner/TaskRunner. UA, screen width and language matched each Profile.
Evidence: /tmp/mimic-r4-workflow.json. The new core fixture assertion initially
omitted its existing wow64/availLeft/availTop derivations; corrected the assertion
without changing normalization behavior.

Final R4 checkpoint: /tmp/mimic-r4-final-tests.log (251/251 passed, 0 skipped),
/tmp/mimic-r4-final-check.log (typecheck/build/13 Shapes/1045 JSON files/1013 Profiles
passed), git diff --check passed. All 2026 corpus Plan identities and operation
digests still match R3 (/tmp/mimic-r4-plans.json). Complete output comparison files
have identical SHA-256 f55daaae81998ee0d0793c39d8737fac9fddeb0e937af9c11f76ed395daec6e8.
No data artifacts, source rules, error codes, Feature revisions, Engine ABI or
schemas changed. The existing flow/run.ts SHA-256 remains
d48a54ada8cadd7297b760b7b5d6c7503693e162d11310cbd7826b4e56ae551c.
No supplier requests, new dependencies or commits. Existing unrelated unused-import
diagnostics from an optional noUnusedLocals check remain outside this stage.

## R5 Work Log

Increment 1: runtime/task.ts now prepares Plan + normalized Job + effective policy,
without deriving a complete run identity from Plan.id. CaptureSession owns lifecycle,
polling, interaction and completion; TaskRunner retains Realm open/error/encode/dispose.
The internal ExecuteMessage explicitly carries policy alongside Job/Plan; public v2
Job, Plan and Result JSON are unchanged. Watchdog start/queue behavior is unchanged.

SDK capture now returns a checked CaptureResult with CaptureValue/CapturePost types;
flow/capture.ts consumes these types instead of reinterpreting posts. NetConfig and
TraceConfig unions are shared between their compiler and Driver, with compile-time
binding checks and the existing runtime validation. Other Driver config contracts
are not rewritten as part of this capture-focused stage.

Real baseline: 11 run/capture cases each in-process and in a worker (22 Results),
including synchronous/asynchronous/binary/empty/iframe/lifecycle/error paths;
/tmp/mimic-r5-before.json and /tmp/mimic-r5-after.json are byte-identical.
First test pass exposed the Job parser's dependency on the full Profile/Shape parser.
Extracted core/job.ts and shared JSON/schema/URL validation instead of weakening
the worker dependency gate. Job validation and normalization now share core/job.ts;
removed the application-layer job helper. Existing parseJob exports remain compatible.

Increment 2: Real prepared execution tests protect policy application independently
of Runner defaults, capture failure cleanup, typed Result validation, and the
currentScript distinction between absent and explicit scriptUrl. The execute-only
load hook rejects Feature compilers, Shape builders, Legacy and core/parse while
executing serialized Plans (/tmp/mimic-r5-boundaries.json). Planning still creates
zero workers and does not load runtime implementations (/tmp/mimic-r5-plan-boundary.json).

Two full interaction captures, different seeds and the same Plan/worker, finished
all three touch sequences before quiet completion: 5813ms and 5544ms, 7 records
each. Worker created/terminated/live = 1/1/0. The actual flow/captureBodies BMS path
returned flow-typed without external network requests (/tmp/mimic-r5-workflow.json).

R5 comparison evidence: /tmp/mimic-r5-before.json and /tmp/mimic-r5-after.json share
SHA-256 8e94539c188154a132651913aa51cef1907e2b163be062d6f0c3f4ce82fd8dcb.
All 2026 corpus Plans/operation digests match R3 (/tmp/mimic-r5-plans.json).
The full R4 normalization and 22 error-case baselines also match after extracting
shared validation (/tmp/mimic-r5-normalization.json, /tmp/mimic-r5-normalization-errors.json).
The resource gate passed with zero live Runtime/worker instances; process RSS grew
from about 198 to 860 MiB in this run, which remains unresolved, not an R5 fix.
Evidence: /tmp/mimic-r5-leak.json. flow/run.ts remains untouched (same R4 SHA-256).

Final R5 checkpoint: /tmp/mimic-r5-final-tests.log (256/256 passed, 0 skipped),
/tmp/mimic-r5-final-check.log (typecheck/build/13 Shapes/1045 JSON files/1013 Profiles
passed), git diff --check passed. No generated data, schema, Feature revision or
Engine ABI change. Job/Result JSON remains v2; only the private worker envelope adds
ExecutionPolicy. No external supplier traffic, new dependencies or commits.

## R6 Work Log

Increment 1: Added a separately hashed capabilities-v1 sidecar to compilation.
Feature-local describe declarations state origin and coverage independently; no
captured/derived label implies complete behavior. Plan.support is projected from
the compatibility label carried alongside each claim. The existing require rank
is isolated as compatibility logic. New assertCapabilities/requireCapabilities
use explicit accepted sets, never an ordering between constant/partial coverage.
Advanced Application.inspect and compileWithCapabilities expose the report while
the default SDK and v2 Job/Plan/Result JSON keep their shape. Custom Features with
no declarations receive unknown behavior, not an inferred fidelity guarantee.

Increment 2: Canvas/Audio/system-color identity synthesis moved under environment/,
with policy legacy-identity-v1. Audio tuples and palettes remain precompiled as
before; Canvas now stores all three MIME results in its bind and the Driver only
selects them. Numerical argument fallback and ordinary method emulation are not
identity synthesis and remain in their own Drivers. SystemColors has no v2
evidence section: new reports use unknown for a full supplied palette, mixed for
partly synthesized palettes, synthetic when none are supplied. The old label is
retained, rather than treating mere field presence as proof of capture.

Intentional migration: Canvas Feature rev 2 -> 3 and Engine ABI v2.10 -> v2.11.
Canvas bind shape and engine/catalog identities change; Plan IDs must change.
This also changes default interaction seeds because those include Plan.id; no
attempt is made to silently change the R5 seed derivation rule. Recompile old
Plans; the Engine manifest check rejects them. Profile/Shape data and wire schema
remain unchanged. Direct Canvas/MIME/iframe/system-color outputs were preserved
(/tmp/mimic-r6-before.json and /tmp/mimic-r6-after.json are byte-identical).
First suite had 255 passes and only the expected old-ABI assertion failed; updated
that assertion and added separate capability/budget/dependency contracts.

Increment 3: quality/memory.ts runs local and worker workloads in
separate child processes. Both isolates force GC and sample heapUsed/heapTotal,
external/arrayBuffers plus V8 malloced_memory/total_physical_size; RSS is sampled
once per process, never counted once per isolate. ArrayBuffers is part of external,
and neither these counters nor RSS minus heap establish total native allocation.
Without explicit RSS/heap budgets, memory status is observed, not passed. A short
smoke run passed (/tmp/mimic-r6-memory-smoke.json). The quality worker uses the actual TaskRunner/Engine, not the
production queue/watchdog; those remain covered by the separate resource gate.

Full memory observation: 20 warmup + 300 measured jobs per mode, sampled every 50.
After GC, local heapUsed peak growth was 1.81 MiB while RSS grew 314.00 MiB
(457.94 -> 771.94 MiB). Worker-mode main heap grew 0.03 MiB and worker heap
1.13 MiB; process RSS grew 363.61 MiB (490.00 -> 853.61 MiB). Every sampled
Engine active count was zero. No budgets were set: both memory statuses are
observed, not passed (/tmp/mimic-r6-memory.json). A separate 20-job run with zero
RSS/heap growth budgets failed in both modes and exited 1 as expected
(/tmp/mimic-r6-memory-rejected.json). Resource cleanup still passed using the
production executor: 2 workers created/terminated, 0 live, natural child exit;
its non-GC RSS growth was about 673 MiB (/tmp/mimic-r6-leak.json).

The first full capability gate found an old Android WebView Shape whose secure
context flag was installed by _shape without enabling the Chrome Feature. Moved
that Window-level description to Globals, which is present for that environment;
no operations or support labels changed. Gate now covers 1013 Profiles, 2026 Plans
and 158016 claims without unknown behavior (/tmp/mimic-r6-capability-gate.json).

All 2026 Plan IDs intentionally changed. Comparing complete Plan bodies after
excluding only engine/catalog/ID and Canvas URL configs found zero other changes
(/tmp/mimic-r6-plans-before.json, /tmp/mimic-r6-plans-after.json). Two serialized
v2.10 Plans failed with install/BAD_PLAN and zero active Realms, before execution
(/tmp/mimic-r6-old-plan.json). Runtime import hooks reject environment synthesis,
Feature compilers, Legacy and Profile parsing while executing iframe/OffscreenCanvas
and capture workloads; planning rejects Drivers, Runner and JsdomEngine
(/tmp/mimic-r6-boundary-plan.json, /tmp/mimic-r6-boundary-execute.json).

R4 full normalization and 22-error outputs remain byte-identical to its baselines.
R5's 22 Results match after replacing only Plan identifier fields, with no other
normalization (/tmp/mimic-r6-normalization.json, /tmp/mimic-r6-normalization-errors.json,
/tmp/mimic-r6-results.json). Full interaction captures completed all three touch
sequences at 5924ms and 5523ms, reusing one Plan and worker; created/terminated/live
= 1/1/0. Real flow capture returned flow-typed without supplier traffic
(/tmp/mimic-r6-workflow.json).

Final R6 checkpoint: /tmp/mimic-r6-final-tests.log (263/263 passed, no skips),
/tmp/mimic-r6-final-check.log (typecheck/build, 13 unchanged Shapes, 1045 JSON files,
1013 Profiles), /tmp/mimic-r6-final-capability-gate.json and the independently
repeated execute-only boundary all passed. git diff --check passed. No generated
Profile/Shape/baseline or lockfile changes. flow/run.ts retains SHA-256
d48a54ada8cadd7297b760b7b5d6c7503693e162d11310cbd7826b4e56ae551c.
No new dependencies, external supplier requests or commits. R0-R6 implementation
is complete; production RSS stability/native attribution and budget calibration
are explicitly not marked complete. See ../spec/capabilities.md for the contract
and repeatable gate commands.

## Remaining Risks

- Process RSS still grows under repeated iframe workloads. Both isolate heaps and
  V8/external counters are now observable, but native/OS allocation ownership and
  operational budgets remain unresolved. Neither cleanup nor forced-GC heap
  observations establish memory stability.
- The original fp-env raw cache is not present locally; direct raw-adapter coverage
  uses fixtures. The full existing migrated corpus was compared independently.
- The default SDK retains v2 support labels; dual-dimensional capability enforcement
  is opt-in through advanced compilation/inspection. Complete execution identity,
  full rendering fidelity and production memory stability are not claimed.
