# ANA Akamai browser/mimic interaction gap analysis

## Scope

This note compares the interaction-related fields in two ANA Akamai captures:

- Browser: `~/Desktop/akamai-www.ana.co.jp-20260901-084619`
- mimic: `~/Desktop/mimic-akamai-www.ana.co.jp-20260901-093239`

The comparison uses the decrypted `dme`, `doe`, `tev`, `pev`, `mev`, and
`mst` fields from each capture's `results/*-abck-*.json` files. It focuses on
event shape, order, timing, and cross-stream relationships. It does not treat
request size or unrelated fingerprint fields as interaction evidence.

## Important controls

The two captures are not a fully controlled A/B experiment:

| Input | Browser capture | mimic capture |
| --- | --- | --- |
| Chrome | 151 | 150 |
| Screen | 393 x 873 | 424 x 942 |
| Locale/time zone | Chinese / Asia/Shanghai | Polish / Europe/Warsaw |
| ABCK script URL | Same | Same |
| ABCK script SHA-256 | Different | Different |

The page also changed slightly between captures. Therefore static payload
fields, request size, and challenge-specific values cannot be attributed to
the interaction model alone. The decoded event schema and enabled event flags
are the same (`do_en,dm_en,t_en`), so event-stream absence and ordering remain
useful evidence.

## Observed event summary

| Observation | Browser | mimic |
| --- | ---: | ---: |
| ABCK payloads | 30 | 5 |
| Capture span | 17.6 s | 12.2 s |
| Maximum motion events in one accumulation block | 10 | 5 |
| Maximum orientation events in one accumulation block | 10 | 5 |
| Maximum touch events in one accumulation block | 14 | 15 |
| Maximum pointer events in one accumulation block | 5 | 0 |
| Maximum mouse events in one accumulation block | 54 | 0 |
| Distinct observed touch starts | At least 6 | 1 |

The mimic column describes the baseline archive captured before the Pointer
projection documented later in this note was implemented.

The browser's early 54 mouse events use coordinates `(-1,-1)` and may include
page-generated or capture-specific noise. They are not sufficient by
themselves to define native mouse behavior. A later sequence does contain
coherent compatibility mouse events at the same coordinates as a pointer-up,
which establishes a tap terminal path. It does not imply that the current
swipe recipe should produce mouse events.

## Confirmed gaps

### 1. Pointer events were absent in the baseline

The browser repeatedly emits pointer-down shortly before touch-start at the
same coordinates:

| Pointer timestamp | Touch timestamp | Delay |
| ---: | ---: | ---: |
| 2076 ms | 2093 ms | 17 ms |
| 2767 ms | 2791 ms | 24 ms |
| 9155 ms | 9179 ms | 24 ms |
| 11748 ms | 11776 ms | 28 ms |
| 513 ms | 536 ms | 23 ms |

The baseline mimic payload has no `pev` entries. Its interaction frame model
and dispatcher supported motion, orientation, touch, and mouse, but did not
project PointerEvent from the touch contact.

The 17-28 ms lead is evidence for this ANA Android capture, not a Web
standard requirement. Pointer Events does not specify ordering relative to
Touch Events. A local Chromium CDP probe delivered `pointerdown` and
`touchstart` with the same event timestamp. The adapter should therefore not
hard-code 17-28 ms as a universal browser invariant without more Android
samples.

There are two native-shaped terminal paths, depending on whether the browser
treats the interaction as a tap or takes control of it for panning:

```text
tap:
pointerover / pointerenter
pointerdown
-> touchstart
-> implicit pointer capture
-> pointerup / capture release / pointerout / pointerleave
-> touchend
-> compatibility mouse events and click

pan/swipe:
pointerover / pointerenter
-> pointerdown
-> touchstart
-> one or more pointermove / touchmove events
-> pointercancel / capture release / pointerout / pointerleave
-> remaining touchmove events / touchend
-> no tap compatibility mouse sequence
```

The browser Akamai payload contains seven distinct pointer-down records but
only one pointer-up. That pointer-up belongs to the short touch at
`(197,1115)` and is followed by mouse events. The other interactions contain
substantial movement and no pointer-up in `pev`. This is consistent with the
browser canceling pointer streams when it takes control of touch panning.
`pointercancel` is not present in the Akamai encoding, so that final inference
is strong but not directly observed by the payload parser.

The Akamai pointer stream itself contains only two event codes in this sample:

```text
code 3: pointerdown (7 unique events)
code 4: pointerup   (1 unique event)
```

No pointer-move row appears in `pev`, even though Pointer Events requires
pointer movement before cancellation. The likely explanation is that this
Akamai script records only pointer down/up, not that Chrome emitted no
pointermove or pointercancel.

That explanation was confirmed by instrumenting listener registration while
executing the captured ABCK script in the mimic Realm. It registers these
input listeners on `document`:

```text
touchmove, touchstart, touchend, touchcancel
mousemove, click, mousedown, mouseup
pointerdown, pointerup
```

It does not register `pointermove` or `pointercancel`. For this script version,
the direct cause of an empty `pev` is therefore exact: the adapter never emits
either pointer event type that the script records. A native-shaped cancel path
still matters for Realm behavior, but it will not add a cancel row to this
version's decrypted `pev`.

The captured deobfuscated script independently confirms the same path:

```text
document.addEventListener("pointerdown", F66, true)
document.addEventListener("pointerup",   m56, true)

F66(event): SFH(); pXH(event, 3)
m56(event):        pXH(event, 4)
```

`pXH` passes the event to the pointer encoder `hmH`. Its accepted record is:

```text
index,eventCode,deltaFromStart,pageX,pageY[,0-if-untrusted];
```

The encoder:

- rejects only `pointerType === "mouse"`;
- uses floored `pageX/pageY`, falling back to client coordinates;
- appends `,0` when `isTrusted === false`;
- does not read `pointerId`, pressure, contact geometry, buttons, target, or
  `isPrimary` for this payload field;
- accumulates `pevl` as the numeric checksum
  `index + eventCode + delta + x + y`, not as a row count.

For example, the browser row:

```text
pev:  0,3,2076,267,507;
pevl: 2853
```

satisfies `0 + 3 + 2076 + 267 + 507 = 2853`. Every mimic payload has both
fields empty/zero because no pointer handler is invoked.

Pointer-down also has a behavioral effect beyond serialization. When the
script's biometric auto-post mode is active, an accepted code-3 event can
trigger an immediate sensor auto-post with reason 2. Pointer-up has no matching
auto-post branch. Adding pointer-down may therefore change payload count and
which cumulative event streams appear in each body; regression analysis must
compare body boundaries as well as checking that `pev` became non-empty.

Only the mimic archive contains an ABCK deobfuscation; the browser archive's
manifest contains `abck.original.js` but no `abck.deobfuscated.js`. The original
scripts are distinct challenge instances:

```text
browser SHA-256: fd67ede41544a5e9a49753471580dcd78575af4d424af2f8a5ce2c7086dc26af
mimic SHA-256:   f083f0984be0b53eaf1611b9c1844d43eba6f04174d030860195fd0f284d5d3d
```

Running the same listener-registration probe against each original script
produced the identical touch/mouse/pointer listener set shown above. The
browser payload rows also satisfy the deobfuscated encoder and checksum
formula exactly. Across cumulative payload copies there are 29 code-3 rows and
4 code-4 rows, representing seven unique pointer-down events and one unique
pointer-up; none contains the untrusted `,0` suffix. This cross-check supports
using the deobfuscated handler semantics for the pointer-gap analysis while
still recording that the two script bytes are not identical.

### 2. The baseline mouse ordering was wrong; tap projection is now implemented

The implemented swipe no longer has the original ordering bug. The removed
baseline paired mouse and touch at every swipe frame and emitted additional
pressed mouse moves after mouse-up:

```text
touchstart + mousedown
touchmove  + mousemove
touchend   + mouseup
```

The current swipe crosses the pan threshold, ends its pointer stream through
`pointercancel`, and emits no mouse or click. That is the correct terminal
class for the swipe recipe. The first Pointer-only implementation omitted tap
compatibility events; the implementation and live validation follow below.

#### Browser payload sequence

The original analysis mislabeled the event at `11158 ms` as touch-end. The
deobfuscated listener table and the decoded rows show that touch code 2 is
touch-start, while mouse code 4 is mouse-up. The corrected tap-like sequence
is:

```text
pointerdown  11032 ms  (197,1115)
touchstart   11058 ms  (197,1115)
pointerup    11131 ms  (197,1115)
mousemove    11134 ms  (197,1115)
mousedown    11135 ms  (197,1115)
mouseup      11158 ms  (197,1115)
click        11210 ms  (197,1115)
```

Touch-end is not visible in this ABCK payload. Its encoder reads the first
entry from `event.touches`; a normal touch-end has an empty `touches` list, so
the handler drops that row instead of falling back to `changedTouches`. The
payload therefore cannot establish the exact touch-end timestamp. The native
Chrome probe below places touch-end after pointer release/out and before the
compatibility mouse chain.

The later mouse buffer contains exactly these four trusted rows:

```text
0,1,11134,197,1115
1,3,11135,197,1115,-1
2,4,11158,197,1115,-1
3,2,11210,197,1115,-1
```

The current ABCK mouse mapping is:

```text
code 1: mousemove
code 2: click
code 3: mousedown
code 4: mouseup
```

For mousemove, the encoder stores index, code, relative time, X, and Y. For
the other three events it also stores a hash of the target's `name` or `id`;
`-1` means neither attribute was available. A non-primary `which` value is
appended when present, and an untrusted mouse event receives an `it0` suffix.
For this challenge, `mevl` is 32 plus the sum of the first five numeric fields
of every row. This gives `24930` after mousemove/mousedown and `49933` after
all four rows, exactly matching flows 479 and 484.

The 54 code-2 rows in an earlier mouse buffer are a separate phenomenon. They
have coordinates `(-1,-1)`, varying target hashes, and the untrusted `it0`
suffix; `nte` reaches 54 while `te` and `pte` remain zero. They are
page-generated clicks, not physical compatibility events, and must not be
copied into the interaction model.

`mousedown` has a payload-boundary side effect. Its handler calls the mouse
encoder with code 3 and immediately invokes the biometric auto-post path.
Consequently, flow 479 contains only mousemove and mousedown. Mouseup and
click execute afterward and first appear in the later cumulative body. A
correct implementation should dispatch the terminal events synchronously and
allow this script-side auto-post to split the bodies; it should not schedule
independent MouseFrames merely to reproduce the observed wall-clock gaps.

#### Android Chrome 151 ground truth

The connected Xiaomi M2012K11AC running Chrome `151.0.7922.173` was probed in
a mobile viewport (`392x754` CSS pixels, DPR 2.75). Both CDP touch input and a
system-level `adb input tap` produced trusted events in this order:

```text
pointerover / pointerenter -> pointerdown -> touchstart
-> gotpointercapture -> pointerup -> lostpointercapture
-> pointerout / pointerleave -> touchend
-> mouseover / mouseenter -> mousemove -> mousedown -> mouseup -> click
```

All terminal events shared the input release `event.timeStamp`; listener wall
time advanced as handlers ran. This is another reason not to model the mouse
chain as separately timed trajectory frames. On the ANA page, ABCK's
synchronous mousedown auto-post and other handlers account for much of the
larger decoded time gap.

The terminal field shapes were:

| Event | Constructor | `button` | `buttons` | `detail` | `firesTouchEvents` |
| --- | --- | ---: | ---: | ---: | --- |
| `mouseover` / `mouseenter` / `mousemove` | `MouseEvent` | 0 | 0 | 0 | true |
| `mousedown` | `MouseEvent` | 0 | 1 | 1 | true |
| `mouseup` | `MouseEvent` | 0 | 0 | 1 | true |
| `click` | `PointerEvent` | 0 | 0 | 1 | true |

The click retained `pointerId=2` and `pointerType="touch"`; Chrome reported
`isPrimary=false` for that click. Pointer events did not expose a non-null
`sourceCapabilities`; Touch events, every compatibility mouse event, and click
had `sourceCapabilities.firesTouchEvents=true`.

A CDP short drag from `(120,120)` to `(124,124)` still completed as a tap. Its
pointer-up used `(124,124)`, but its compatibility mouse events and click were
anchored at `(120,120)`. The implementation therefore anchors compatibility
events to the initial contact instead of the final TouchFrame coordinate.

The same device established the tap/pan boundary for this setup:

```text
single-axis movement 5..8 px: pointerup + touchend + full mouse/click chain
single-axis movement >= 9 px: touchmove + pointercancel + no mouse/click
diagonal movement (5,5) px:   tap path (distance 7.07 px)
diagonal movement (6,6) px:   cancel path (distance 8.49 px)
```

This supports an Euclidean threshold strictly greater than 8 CSS pixels. The
dispatcher now uses `distance > 8`, matching this captured boundary.

Cancellation cannot be represented by one generic "mouse allowed" flag:

| Canceled event | Observed terminal result |
| --- | --- |
| none | full mouse chain and click |
| primary `pointerdown` | mouseover/mouseenter and click remain; mousemove/down/up are suppressed |
| `touchstart` | no compatibility mouse and no click |
| `touchend` | no compatibility mouse and no click |
| pan / pointer cancellation | no compatibility mouse and no click |

The pointerdown result matches Pointer Events' `PREVENT MOUSE EVENT` rule:
canceling a primary pointerdown suppresses compatibility mouse events but does
not suppress boundary mouse events, and click follows its own dispatch rules.
Touch cancellation is stronger in the observed Chrome path.

#### Implemented boundary

Compatibility mouse remains a deterministic projection of one completed tap,
not another sampled trajectory:

1. Add a separately modeled tap; do not reinterpret a CSD4CA upward swipe as
   a tap.
2. Keep the target, initial coordinates, release coordinates, cancellation
   state, and pointerdown dispatch result in the active contact state.
3. Use a `> 8` CSS-pixel Euclidean pan decision for this captured Chrome 151
   boundary, subject to validation on other target Profiles.
4. On a successful tap, complete pointer-up/out/leave and touch-end first,
   then synchronously dispatch mouseover/enter/move/down/up and click.
5. Respect the distinct pointerdown, touchstart, and touchend cancellation
   outcomes above rather than treating all `preventDefault()` calls alike.
6. Use MouseEvent for the mouse sequence and PointerEvent for the Chrome-style
   click, preserving the stable target, button state, detail, and touch source
   capability.
7. Do not add MouseFrame back to `InteractionFrame`, do not emit compatibility
   mouse during a pan, and do not manufacture timers to force ABCK body count.

jsdom 29 does not expose `InputDeviceCapabilities` or the native
`sourceCapabilities` property. That does not block this ABCK script, whose
mouse encoder does not read the field, but it is a separate DOM-fidelity gap
before mimic can claim a complete Chrome compatibility-mouse object shape.

The interaction layer now implements that boundary without changing the
public adapter or Job API:

- Internal `tap` synthesis emits a two-frame contact lasting a seeded 70-130
  ms. CSD4CA has no tap trajectories, so only the captured contact-start
  position, radius, and pressure marginal is reused; no swipe path is relabeled
  as a tap.
- The policy emits motion, an upward swipe, the tap at 2500 ms, and a follow-up
  upward swipe at 2900 ms. The spacing exceeds the compiled swipe maximum and
  prevents overlapping contact state.
- Successful tap completion projects pointer-up/out/leave, touch-end, then
  mouseover/enter/move/down/up and a PointerEvent click synchronously from the
  same contact. Main-button events expose `which=1` as Chrome does.
- Pointerdown, touchstart, and touchend cancellation retain their distinct
  Chrome 151 terminal outcomes. A pan still terminates through pointercancel
  and never emits compatibility mouse.
- The follow-up swipe supplies a natural pointerdown auto-post boundary that
  carries the prior tap's mouseup and click. The adapter does not call Akamai
  internals or manufacture a POST.

The first live tap run produced ten ABCK bodies and confirmed why the follow-up
was required: its last body contained only mousemove and mousedown. After the
follow-up and `which` corrections, the designated ANA run generated twelve
bodies, all returned HTTP 201, and `_abck` reached `~0~`. Concurrent tf-dev
traffic was excluded by matching this run's exact request-body lengths; its
ABCK POST ids were `29,30,32,34,35,36,37,38,39,40,42,44`. Long payloads decoded
with file hash `8066499`.

Body 42 contains the completed trusted compatibility sequence followed by the
next swipe's pointerdown:

```text
mev:
0,1,2608,244,598;
1,3,2609,244,598,-1;
2,4,2619,244,598,-1;
3,2,2620,244,598,-1;

pev suffix:
2,4,2605,244,598;
3,3,2942,261,574;
```

No mouse row has an untrusted `it0` suffix or the earlier non-primary
`which=0` column. `te=1` and `pte=1` confirm one trusted click. Body 44 then
adds the follow-up touchstart, while `mev` remains unchanged, confirming that
the second swipe does not create compatibility mouse. ANA's final verify still
returned the separately classified edge HTTP 403 after the valid `~0~` cookie.

### PointerEvent runtime feasibility

The missing payload is not caused by a jsdom constructor limitation. jsdom
29.1.1 already exposes a Realm `PointerEvent` implementation that inherits
from `MouseEvent` and supports:

```text
pointerId, pointerType, isPrimary
width, height, pressure, tangentialPressure
tiltX, tiltY, twist, altitudeAngle, azimuthAngle
getCoalescedEvents(), getPredictedEvents()
```

A direct mimic Runtime probe also confirmed that the existing trusted-event
bridge can dispatch this object without an Engine change:

```text
constructor: PointerEvent
Object tag:  [object PointerEvent]
instanceof:  PointerEvent and MouseEvent
isTrusted:   true
```

Values for `pointerId`, `pointerType`, `isPrimary`, contact geometry,
pressure, buttons, and coordinates survived dispatch. Therefore the minimal
payload fix does not require a new Feature, a new Driver, or an Engine ABI
revision. The existing TouchFrame can remain the single contact record, with
the interaction dispatcher projecting both PointerEvent and TouchEvent from
that frame.

There are two separate structure/fidelity gaps:

1. `resources/probe.js` does not currently capture `PointerEvent` constructor,
   prototype, or instance structure, so mimic has no Chrome-versioned Shape
   evidence for this interface.
2. jsdom does not implement Element pointer-capture methods. mimic exposes
   `setPointerCapture`, `releasePointerCapture`, and `hasPointerCapture` as
   shape-only DOM stubs; all return `undefined`, and no capture state exists.

The first gap does not block dispatch. The second does not block the Akamai
`pev` minimum if every generated event is explicitly sent to the same target,
but it prevents claiming a complete browser input pipeline.

### Pointer field mapping

The W3C requirements and local Chromium probe support the following initial
mapping for one primary touch contact:

| Field | Down | Move | Up/cancel |
| --- | --- | --- | --- |
| `pointerId` | Deterministic active-contact ID | Same ID | Same ID |
| `pointerType` | `touch` | `touch` | `touch` |
| `isPrimary` | `true` | `true` | `true` |
| `button` | `0` | `-1` | `0` |
| `buttons` | `1` | `1` | `0` |
| `pressure` | Touch force, or `0.5` fallback | Touch force | `0` |
| `width` / `height` | Contact geometry | Contact geometry | `1` if unavailable |

In the local Chromium CDP probe, input radii `(7,9)` produced pointer contact
geometry `(14,18)` and pressure was copied from force. This supports
`width=2*radiusX` and `height=2*radiusY` for Chromium, but that mapping is not
stated as a cross-browser Pointer Events requirement and should be validated
on the target Android Chrome before being treated as captured evidence.

Chrome allocated pointer IDs `2` then `3` for two sequential contacts in the
local probe. The specification does not assign semantic meaning to the number;
it only requires a stable unique ID among active pointers. mimic should use a
deterministic per-session allocator rather than equating pointerId with the
current fixed Touch identifier.

### Minimal implementation boundary

For the current upward swipe recipe, the smallest coherent pointer addition is:

1. Keep TouchFrame as the single timed contact representation; do not add a
   second coordinate stream or change the public interaction API.
2. Derive pointer coordinates, geometry, and pressure from that same frame in
   the dispatcher.
3. Dispatch `pointerover`, `pointerenter`, and `pointerdown` before touch-start
   at the swipe target.
4. Dispatch pointer moves only until the swipe crosses a deterministic pan
   recognition threshold.
5. Terminate with `pointercancel`, then pointer out/leave semantics; do not
   emit pointer-up or compatibility mouse for that swipe.
6. Keep one target for the active pointer to approximate implicit capture.
7. Remove MouseFrame output from the swipe synthesizer, including the twelve
   post-up moves that currently retain `buttons=1`.
8. Preserve the complete sequence under the existing interaction seed.

Only `pointerdown` from this swipe lifecycle is expected to be visible in the
current Akamai `pev`, because its listener set excludes move and cancel. The
payload-level regression should therefore expect code 3 at the same contact
coordinates as touch-start, and should not invent a code-4 pointer-up for a
canceled swipe merely to increase the pointer count.

The remaining PointerEvent fields still matter for DOM fidelity and for other
scripts, but they are not required to explain this captured script's empty
`pev`. The minimum Akamai-visible event must have `pointerType="touch"`,
non-zero page/client coordinates, and `isTrusted=true`; the existing trusted
bridge can already satisfy those conditions.

A tap recipe is separate work. It requires pointer-up and the post-touch mouse
and click chain, and should not be smuggled into the existing swipe recipe.

### Implementation and live validation

This boundary is implemented in `src/interaction/dispatch.ts`,
`src/interaction/synthesize.ts`, and `src/interaction/types.ts`. The swipe now
contains only the 16 model TouchFrames. The dispatcher projects PointerEvent
and TouchEvent from the same frame, keeps one target, recognizes pan at 8 CSS
pixels, terminates the pointer stream with cancel/out/leave, and continues the
touch stream through touch-end. The current one-contact policy uses pointer ID
2; a per-session allocator remains necessary before multiple contacts or
gestures are introduced.

Focused Realm tests observed the following contract:

```text
pointerover -> pointerenter -> pointerdown -> touchstart
pointermove -> touchmove -> pointercancel -> pointerout -> pointerleave
remaining touchmove events -> touchend
```

Every event is trusted and keeps the BODY target selected at contact start.
Pointer coordinates match the Touch point, contact width/height are twice the
Touch radii, and pressure matches Touch force to float32 precision. The swipe
does not emit pointer-up, mouse, or click.

Two live ANA runs through reqable/tf-dev used the same v150 Profile and current
ABCK script. The latest run boundaries were flow IDs 41-53; the preceding run
was 20-32. File hash 7934296 decoded both. They independently produced:

```text
flow 26: pev="0,3,87,255,581;"  pevl=926
flow 28: tev="0,2,93,255,581,1;"

flow 47: pev="0,3,82,266,627;"  pevl=978
flow 49: tev="0,2,89,266,627,1;"
```

Both pointer rows are trusted code 3 records: there is no untrusted `,0`
suffix, each checksum equals the sum of its numeric fields, and each point
matches the following touch-start. No code 4 appears, as expected for the pan
cancel path. Pointer-down's script-side auto-post changed capture from five to
seven bodies and placed the pointer snapshot before the touch snapshot.

Both Pointer-enabled runs stayed at `_abck ~-1~`. A temporary A/B build with
only Pointer projection disabled restored five bodies but also stayed at
`~-1~` under the same Profile, script size, proxy, and all-body policy. The
current cookie result therefore does not isolate Pointer as the cause; the
confirmed Pointer effect is the two additional event-driven body boundaries.
The production source was restored and rebuilt after this diagnostic.

### 3. Motion and touch lose their source correlation

The browser capture shows sensor activity synchronized with touch. One clear
example is:

```text
touchstart   9179 ms
motion       9207 ms
orientation  9207 ms
rotation     (-5.4, -13.9, 0.3)
```

CSD4CA stores touch, acceleration, gravity, rotation, and orientation in one
trajectory. Runtime synthesis currently samples the model separately for
`motion-burst` and `swipe`. The recipe is also part of the PRNG seed, so the
two streams may use different groups and PCA coefficients.

The runtime should reconstruct one gesture sample and derive every associated
event stream from that sample:

```text
sampleGesture()
-> motion frames
-> orientation frames
-> pointer frames
-> touch frames
-> tap compatibility events
```

### 4. Device pose is not conditioned to the session

Representative values differ substantially:

```text
Browser gravity:     approximately (0.2, 0.1, 9.8)
Browser orientation: approximately (359.9, 0.3, -1.0)

mimic gravity:       approximately (-0.07, 4.41, 8.42)
mimic orientation:   approximately (91.6, 0.4, 27.7)
```

The browser device is close to flat in this sample; mimic represents a much
more tilted device. The current adapter does not condition baseline pose on
Profile, screen orientation, or the selected gesture session.

### 5. The policy still emits a limited gesture set

The browser capture contains multiple interaction forms:

- Repeated touch starts
- Upward swipes
- Short drags
- Tap-like short touches
- Downward or non-monotonic movement
- Gesture continuation across Akamai accumulation resets

The baseline mimic capture contains one smooth upward swipe, approximately:

```text
(267,678) -> (297,510), about 36 ms
```

The compiled runtime model retains only upward groups. The built-in policy now
emits an initial upward swipe, a separately modeled tap, and a follow-up upward
swipe that flushes the tap state through a natural ABCK event boundary. This
covers the two terminal classes needed for mouse fidelity, but not
downward/non-monotonic gestures, scroll-linked interaction, or the observed
session-level diversity.

### 6. Page, viewport, and screen coordinates are collapsed

The browser screen height is 873 CSS pixels, while decoded touch Y values
include `918`, `1115`, `1166`, `1382`, and `1640`. This strongly indicates
page coordinates or a scroll offset rather than viewport-only coordinates.

Current mimic dispatch sets:

```text
pageX = clientX = screenX
pageY = clientY = screenY
```

It also does not update page scroll state. This prevents browser-shaped values
for:

- `scrollX` and `scrollY`
- Page/client coordinate conversion
- Touches on content below the initial viewport
- Target changes caused by scrolling

### 7. The baseline targeted `document`

The baseline adapter dispatched generated events to `document`. Real events
target the element under the contact point and bubble through the document.
Target identity can affect Akamai's event encoding and event acceptance.

The implemented dispatcher resolves `elementFromPoint` when available and
otherwise keeps `body`, `documentElement`, or `document` as one stable contact
target. Current jsdom tests use the `body` fallback; this avoids a document
target but does not claim layout-backed hit testing.

### 8. Sensor cadence is a one-shot dense burst

The model schedules 16 reconstructed sensor frames across one 180-400 ms
burst, but Akamai retains only five motion and five orientation events in the
mimic capture. Browser sensor events are sparse, clustered around gestures,
and continue across multiple gesture cycles.

This suggests that event cadence must be designed at the session/gesture
level, including Akamai's own sampling or throttling behavior. Increasing the
number of generated frames alone is not sufficient.

### 9. Capture does not continue from real response state

The browser continues interacting across many ABCK requests and stream resets.
ANA/Cebu currently generate all bodies inside one Realm before Python sends
them. Real `Set-Cookie` responses do not update that Realm or affect later
generated bodies.

This is broader than event synthesis, but it limits any attempt to reproduce
the browser's repeated event/request lifecycle.

## Event-state fields

Several decoded fields change in the browser but remain zero in mimic:

```text
tab:  0 -> 8 -> 0
te:   0 -> 1
nte:  0 -> 54
pnte: 0 -> 27
pte:  0 -> 1
```

The deobfuscated trust handler establishes most of this counter family:

```text
te / nte / mte:    total events with isTrusted true / false / absent
pte / pnte / pmte: matching current-window counters, reset after post handling
```

These counters cover events passed through that shared trust handler, not
every row written to `mev`, `pev`, or `tev`. In this capture, the 54 scripted
untrusted clicks account for `nte=54`; the later trusted compatibility click
increments `te` and the current-window `pte` from zero to one. Their values
should emerge from the event lifecycle and must not be hard-coded. `tab` and
the exact reset policy around the remaining counters are still not established
well enough to model directly.

## Implementation priority

### Completed in the current change

1. Project PointerEvent and TouchEvent from one TouchFrame.
2. Terminate the pan with pointer cancellation and no tap-style mouse events.
3. Keep one plausible element target for the contact lifecycle.

### Priority 0

1. Reconstruct touch, motion, and orientation from one model sample.

### Priority 1

1. Add repeated session gestures rather than increasing the global one-swipe
   policy merely to chase POST count.
2. Support taps, short drags, non-monotonic movement, and more than one
   direction.
3. Model page scroll offsets and distinct page/client/screen coordinates.
4. Condition baseline pose and sensor cadence on the Profile/session.

### Priority 2

1. Allow subsequent capture activity to consume prior response/cookie state.
2. Re-evaluate unresolved Akamai lifecycle fields after the event sequence is
   native-shaped.

## Acceptance criteria

An interaction rework is not complete merely because more events are emitted.
It should demonstrate all of the following in a decrypted capture:

1. `pev`, `tev`, `dme`, and `doe` are non-empty for the same gesture.
2. Pointer/touch ordering matches target-browser evidence; the ANA-specific
   17-28 ms lead is not treated as a universal standard constant.
3. A swipe terminates its pointer stream with cancellation and emits no
   tap-style compatibility mouse; a separately modeled tap uses pointer-up
   and compatibility mouse only after touch completion.
4. Motion/orientation values come from the same reconstructed model sample as
   the touch trajectory.
5. More than one gesture can occur without restoring injected customer-script
   wrappers.
6. At least one gesture uses a non-document target.
7. Page coordinates can differ from client coordinates when the page is
   scrolled.
8. A repeated fixed seed reproduces the complete multi-stream event program.
9. Different seeds vary the program without violating event order.
10. ABCK body count, `_abck ~0~`, and the final business response are reported
    separately.

## Non-conclusion

These gaps explain why the mimic interaction payload differs materially from
the browser payload. They do not prove that interaction generation is the sole
cause of ANA's final edge HTTP 403. Existing model-driven flows have reached
`_abck ~0~` when all five bodies are posted, while ANA's final request can
still be rejected independently at the edge. Wire identity, proxy reputation,
request rate, static credentials, and challenge variation must remain separate
diagnostic dimensions.

## Interaction research sources

- [W3C Pointer Events](https://w3c.github.io/pointerevents/): pointer lifecycle,
  cancellation for direct manipulation, implicit capture, field semantics,
  and compatibility mouse mapping.
- [MDN Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events):
  interface and button-state reference.
- Local Chromium 150.0.7871.124 CDP input probe: trusted tap and swipe event
  order, contact geometry, pressure, implicit capture, and pan cancellation.
- Connected Xiaomi M2012K11AC with Android Chrome 151.0.7922.173: mobile
  viewport CDP taps, short drags and cancellation probes, plus a system-level
  `adb input tap` confirmation of constructor, ordering, source-capability,
  and button-state behavior.
- ANA Android browser payloads under
  `~/Desktop/akamai-www.ana.co.jp-20260901-084619/results/`: Akamai `pev`,
  `tev`, and `mev` encoding and target-session timing.
- Deobfuscated challenge under
  `~/Desktop/mimic-akamai-www.ana.co.jp-20260901-093239/abck.deobfuscated.js`:
  listener registration, event-code mapping, trust counters, checksums, and
  mouse-down auto-post behavior.
