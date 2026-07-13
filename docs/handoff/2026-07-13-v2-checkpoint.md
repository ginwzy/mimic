# Mimic v2 checkpoint handoff

Date: 2026-07-13

Branch: `main`

Base before this checkpoint: `83624a2`

Tracker: `js-sandbox-env-framework-sjz` (in progress)

## Goal

Replace the v1 patch pipeline with a TypeScript architecture based on:

```text
Profile + Shape + Page + Job -> Plan -> Engine -> Runtime
```

The default package entry remains v1 until every P8 cutover gate passes. New v2
work belongs in `src/v2` and should stay TypeScript.

Authoritative design:

- `docs/spec/v2-architecture.md`
- `docs/spec/v2-migration.md`
- Epic `js-sandbox-env-framework-sjz`

## Current state

P0-P5 are implemented:

- P0: frozen v1 Oracle and machine benchmark under `harness/oracles`.
- P1: strict JSON Schema, parse, seal, hash, and Result codec contracts.
- P2: `LegacyProfiles` imports current profiles into immutable v2 data.
- P3: deterministic Feature graph compilation into a sealed `Plan`.
- P4: `JsdomEngine`, `Runtime`, driver `Port`, disposal, and report boundary.
- P5: view, screen, chrome, touch, nav, ua, plugins, globals, dom, net, time,
  perf, canvas, webgl, audio, and trace features/drivers.

Built-in composition has one owner: `src/v2/features/index.ts`. Do not rebuild
parallel feature/driver lists in application adapters.

The latest verified gates are:

```text
npm run typecheck:v2       pass
node scripts/v2-dom-data.ts --check
                           pass
npm run test:v2            20/20 files pass
npm run test:legacy        pass
npm run check              pass (82 source, 1030 JSON, 1012 profiles)
```

## Remaining work

Continue in this order:

1. `js-sandbox-env-framework-sjz.1` (P6 Run)
   Build one application task layer for `run/capture/probe/diagnose`, then put
   SDK, worker, CLI, and HTTP adapters around the same Job/Result contract.
   Carry over watchdog, dead-microtask, serialization-trap, close-pollution,
   and backpressure tests from v1. Split production build output from tests.
2. `js-sandbox-env-framework-sjz.2` (P7 Collect)
   Move collect, probe, catalog import, and schema migration to TypeScript.
   One visit must yield Profile + Shape; raw evidence stays immutable and all
   derived artifacts must be reproducible.
3. `js-sandbox-env-framework-sjz.3` (P8 Cutover)
   Run golden parity, five explicit Profile/Baseline budgets, performance and
   leak gates. Bump the current `mimic-jsdom-v2.6` ABI, define production
   exports/bin, and only then switch the default entry. Keep a short-lived
   legacy adapter and delete v1 in the following release.

## Constraints

- Keep names short, but preserve the fixed domain terms: Profile, Shape, Page,
  Job, Plan, Feature, Driver, Engine, Runtime, Port, Result.
- Domain/compiler code must not import jsdom, workers, HTTP, or the filesystem.
- Only an Engine may depend on jsdom. Adapters must not know Engine internals.
- Unknown capability is explicit; a feature must not guess missing device data.
- Cross-boundary results and reports must be validated JSON-safe values.
- The P0 benchmark records local CPU/kernel/memory. Compare performance only on
  equivalent hardware or regenerate the baseline for the target CI machine.
- `br sync --flush-only` currently writes JSONL and then may report
  `expected canonicalized numbered placeholder` because of legacy numbered
  issues. Validate the JSONL diff; do not force-delete or rebuild tracker data.

## Suggested skills

- `tdd`: implement each remaining phase from its exit gate.
- `code-review`: audit the final P6-P8 diff against the specs before cutover.

Start the next session by claiming `js-sandbox-env-framework-sjz.1`, reading
the two spec files above, and adding the adapter-level failing tests first.
