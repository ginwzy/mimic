# Bounded Layout Replay

`Page.layout` is an optional, task-local geometry snapshot. It is not a CSS layout
engine. Without this field, mimic keeps its existing geometry and interaction
behavior, including the legacy capture-only page-offset projection.

## Input and ownership

Use standards-mode HTML with the root rectangle at the document origin. The
`PageLayout` contract is exported from `mimic/advanced` and specified by
`schemas/v2/layout.schema.json`. Page validation checks structure, scroll bounds,
parent ordering, unique selectors and complete paint ordering. Planner preserves
the field when overlaying Pages; changing an inherited Page's HTML or URL requires
a fresh explicit layout. Cookie-only overrides may retain the snapshot.

- `version: 1` identifies the bounded model, not a browser version.
- `viewport` supplies fixed CSS-pixel dimensions and measured screen/client
  offsets. Its width and height must match the installed environment.
- `root` supplies document scroll extents, initial offsets, allowed pan axes and
  overscroll policy. All scroll offsets are nonnegative; RTL is not supported.
- `nodes` follows actual DOM-parent order, beginning with `documentElement`.
  Include body and every body element except script/style nodes. Selectors must
  match exactly one element, and different selectors cannot alias one element.
- Each node has one parent-content-relative rectangle, hit eligibility, clipping,
  `touchAction`, and an optional scrollport. Root document scrolling is stored
  separately from nested scrollports. Rectangles describe borderless boxes.
- `paintOrder` explicitly lists every node once, front to back. It is supplied
  evidence, not inferred from DOM order or arbitrary CSS stacking rules.

The sealed Page hash and `Plan.boot.layout` include these inputs. Realm creation
clones them into private mutable state; scrolling never mutates the Plan or
another task. Default SDK and HTTP method sets do not change. The v2 Page and Plan
schemas add optional fields; Result and Job JSON are unchanged.

Use the existing Page path, for example after obtaining `html` and `layout`:

```ts
import { createMimic, digest, seal } from 'mimic/advanced';

const page = seal({
  schema: 2 as const,
  id: 'local-layout',
  source: { kind: 'manual' as const, hash: digest(html) },
  url: 'https://layout.test/',
  html,
  layout,
});
const client = createMimic({ profile: 'android-webview-v138', page });
try {
  const result = await client.run({ kind: 'run', code: 'document.body.getBoundingClientRect().top' });
} finally {
  await client.close();
}
```

That Profile matches the local fixture's 394x749 viewport. Using desktop mobile
emulation geometry with it is a component test, not Android-device evidence.
Production callers must supply appropriate HTML, Profile and layout provenance.

## Behavior

One state drives root `scrollX/Y`, `pageX/YOffset`, scrolling-element offsets,
VisualViewport page offsets, element bounding rectangles, client/scroll metrics,
borderless offset width/height, and document hit testing. Programmatic window and
element `scroll`, `scrollTo`, `scrollBy`, `scrollTop` and `scrollLeft` clamp to the
recorded bounds. Nested offsets affect descendants' rectangles and clipping, not
page coordinates. Root scroll events bubble from document; nested scroll events
do not bubble. VisualViewport listeners and `onscroll` receive root scroll events.
Notifications are coalesced onto a timer; compositor/rAF timing is not reproduced.

Trusted interaction source receives private layout access, not a page-visible
global. Each new contact resolves its current hit target and keeps that target
for the contact. Page coordinates use current root offsets; screen coordinates
use the supplied offsets. CaptureSession does not also add its legacy synthetic
displacement. An unavailable hit target fails the layout task instead of silently
falling back to BODY.

Touch pan consults the recorded touch-action chain and scrollports. A canceled
touchstart or pre-pan touchmove blocks takeover; passive listeners cannot cancel
it. After takeover, later touchmoves are noncancelable. Nested scroll bounds and
overscroll policy control propagation to ancestors. A moved but blocked contact
does not become a compatibility-mouse tap. The inherited 8px threshold is a model
choice, not a cross-device measurement. Motion is a direct, non-inertial projection;
it does not reproduce browser velocity, friction, overscroll effects or snapping.

## Validity boundary

This mode fails rather than extrapolating stale geometry. Structural DOM changes,
text/attribute changes, CSSOM changes, viewport mismatch, frames and shadow trees
invalidate the task. The temporary head script used for `document.currentScript`
is exempt from child-list invalidation. Unmapped geometry reads and the explicitly
rejected APIs below also invalidate the task. Invalidation is sticky even if page
code catches the immediate exception; Runtime checks it at script/report boundaries.

Captured layouts must exclude fragmented, transformed, rounded or nonrectangularly clipped, bordered,
fixed or sticky boxes, non-horizontal writing, RTL, smooth/snap scrolling,
animations and dynamic CSS states. `captureLayout` rejects unsupported inputs it
can inspect; it does not derive a general stacking order or prove manually supplied
geometry. DOM/CSS invalidation is conservative, including many changes that might
not actually move a box. Recompile with a fresh snapshot after such changes.

`getClientRects`, offset-parent geometry, `scrollIntoView`, shadow attachment,
general layout/reflow and full WebIDL/reflection fidelity are not provided by this
model. The ordinary DOM/View installation is required. It is not a browser engine
or a security sandbox; APIs outside this contract retain their existing behavior,
and no built-in capability is upgraded to `complete`. Layout
overlays report mixed/partial DOM/View behavior, while legacy Support labels remain
compatibility projections.

## Capture and verification

`captureLayout(options)` is a self-contained browser-side probe exported from
`mimic/advanced`; it can be serialized for browser evaluation. It reads native
rectangles, extents, offsets and supported style facts. The caller must specify
selectors, paint order, measured screen offsets and root pan/overscroll policy.
Cross-origin stylesheets whose CSSOM cannot be inspected can make capture fail.

The reproducible local control and real SDK/worker replay are:

```sh
npm run build
node scripts/probe-layout.mjs /tmp/layout-native.json
node scripts/replay-layout.mjs /tmp/layout-native.json
```

Set `CHROME_BIN` when Chrome is not at the default macOS application path. The
probe uses Node's WebSocket API, an isolated headless Chrome process and local HTML,
not a supplier page. Do not run production rebuilds concurrently with worker probes.

`test/fixtures/layout-browser.json` records Chrome 152 mobile-emulation evidence
for root scroll, nested scroll, touch-action blocking and canceled touchmove.
Tests compare native initial and programmatic geometry, then check synthetic input
invariants rather than requiring the same touch trajectory or scroll displacement.
There is no Android-device, ANA acceptance or memory-stability claim.

## Compatibility

Engine ABI is `mimic-jsdom-v2.12`. Existing Plans must be recompiled, including those
without layout, because the Engine installation contract changed. Their Plan IDs,
and therefore default effective interaction seeds, change. Profile/Shape artifacts
and default Plan operations remain unchanged; layout-enabled Plans additionally
carry the new boot data. Consumers loading the extended v2 schemas must register
the new layout schema as well.
