# Architecture Refactor

## Objective

Keep the Profile -> Shape -> Plan -> Runtime model while making planning,
execution, browser compatibility, evidence normalization, and resource ownership
independently understandable. Prefer deep modules with small interfaces over
additional frameworks or purely cosmetic directory changes.

## Constraints

- Preserve the public SDK and v2 wire contracts during structural changes.
- Keep immutable, content-addressed Plans and one disposable Realm per job.
- Keep real supplier HTTP traffic in flow/, outside the Realm.
- Separate intentional fidelity corrections from behavior-preserving refactors.
- Preserve source provenance, synthetic markers, error phases, and JSON safety.
- Do not silently update generated snapshots to hide observable differences.
- No package split, dependency injection container, global event bus, or generic
  supplier workflow framework.
- Do not change unrelated credentials or perform external supplier requests.

## Stages

### R0: Verification Baseline

Reproduce existing failures. Correct corpus inventory expectations, normalize
invalid profile errors at their common source, and resolve the Notification
structure regression. Record intentional behavior changes separately.

Acceptance: typecheck, build, shape/data checks, full test suite; retain probe
differences and inventory evidence where an expectation changes.

### R1: Planning and Execution

Extract a Planner that depends on Profiles, Features, driver identifiers and an
Engine manifest, not an executable Runtime. Replace Application inheritance with
composition. Keep Application as an advanced compatibility facade. Give workers
an execute-only runner and explicit protocol; create workers only for execution.
The Node composition root chooses concrete implementations.

Acceptance: identical Plans for unchanged inputs; SDK/CLI/HTTP and advanced
execution work; list/plan create zero workers; queue, timeout and close contracts
continue to hold. Pure planning must not import the execution runner.

### R2: Execution Resource Ownership

Use a task-scoped ExecutionSession for resources shared by parent and child
Realms. Remove module-level references to a task's Realm. Separate generic
installation from feature-specific report reduction and jsdom compatibility.
Keep cleanup ordering and partial-install failure handling explicit.

Acceptance: multi-job and iframe workflows, disposal failures, worker reuse,
resource leak gate and sustained memory observations. Handle cleanup is not proof
of a memory plateau; report both independently.

### R3: Feature Organization

Give each Feature ownership of its structure and behavior. Replace recursive
cross-feature Shape calls with explicit ordered composition and conflict checks.
Separate compile and runtime entry points. Pilot on a small feature before DOM,
Canvas and Audio; preserve existing operation order and content hashes unless a
semantic change is explicitly recorded.

### R4: Evidence Normalization

Extract format-independent identity normalization from Legacy. Legacy, fp-env and
Collect become input adapters, retaining their source validation and provenance.
New capture data must not need to impersonate a legacy document.

Acceptance: full corpus normalization, stable Profile/Page/Shape identities,
collection round trips, inheritance and invalid-input contracts.

### R5: Execution Contracts and Policies

Represent prepared execution as Plan plus normalized Job and effective execution
policy. Plan identity remains installation identity, not complete run identity.
Encapsulate capture in a CaptureSession; make lifecycle, deadlines, completion
and interaction policy explicit. Add typed capture results and local driver
configuration unions while retaining JSON wire compatibility.

### R6: Capability Semantics and Enforcement

Separate evidence origin from behavior coverage; retain legacy SupportMap as a
compatibility projection. Centralize versioned fallback identity policy rather
than choosing synthetic identity in runtime drivers. Add dependency-direction
checks and repeatable long-run validation. Wire changes require explicit schema,
Feature revision or Engine ABI decisions, not incidental hash churn.

R6 implementation: capabilities-v1 is a separately hashed advanced report, not a
new v2 wire field. Canvas bind migration explicitly advances its Feature revision
to 3 and Engine ABI to v2.11; old Plans must be recompiled. See
[capabilities.md](capabilities.md) for scope, compatibility and gate semantics.
Memory observation is distinct from a passing budget and does not close the
remaining RSS investigation.

## Iteration Policy

Implement in stage order, with small verified increments inside each stage.
Update docs/notes/architecture-refactor-progress.md after each increment with
changed files, actual verification and remaining work. Keep existing compatibility
facades only where they serve published callers. Do not mark a stage complete on
typechecking alone: execute its affected workflows.

If an external dependency, missing evidence or incompatible contract decision
blocks progress, record the exact blocker and required decision. Do not weaken
assertions or silently remove scope to claim completion.
