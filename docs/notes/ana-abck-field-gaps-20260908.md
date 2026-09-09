# ANA ABCK field gaps: real Chrome and mimic

## Evidence and scope

The 2026-09-08 comparison uses these local exports:

- mimic: `~/Desktop/mimic-akamai-aswbe.ana.co.jp-20260908-054638`
- Real Chrome: `~/Desktop/real-akamai-www.ana.co.jp-20260908-055240`
- Profile: `android-chrome/m2012k11ac-v152-1788833327264`

Both exports describe Android Chrome 152, not desktop Chrome. There are five
mimic ABCK payloads and twenty real payloads. The complete fingerprint fields
appear in three mimic payloads (554-556) and fourteen real payloads. Representative
files are `results/004-abck-flow-555.json` and `results/004-abck-flow-108.json`.
Field meanings below were checked against both exported deobfuscated scripts,
not inferred from differences between opaque hashes alone.

This is not a controlled same-page, same-region experiment. Exclude page URLs,
cookies, POST and event counts, navigation, elapsed time, performance timings,
dynamic memory values, and the intentional regional selection from the defect
list. In particular:

- mimic uses `en-SC` / `Indian/Mahe`; real uses `zh-CN` / `Asia/Shanghai`.
- The corresponding `fpt` timezone and `fpc` checksum differences are consistent
  with those regions. The canvas portion is disabled in both exports.
- The first six `s157` codec-support bits match. Its last number is elapsed time,
  not a seventh codec-support bit.
- The earlier sensor scheduling, pose-distribution and ANA body-selection notes
  remain independent issues; this work does not change them.

The first two mimic exports have a suspected decoding-layout error:
`fileHash=8538667` puts the string `PiZtE` in `din.pha`; later exports use
`fileHash=1735033`, put `PiZtE` in `mst.jsrf`, and report `din.pha=0`.
The original bodies have been evicted from tfdev, so this cannot currently be
re-decoded. Do not treat those early field placements as runtime defects.

## Repair order

| Order | Issue | Fields | Status |
| --- | --- | --- | --- |
| 1 | Unsupported fetch schemes resolve successfully | `sww.ext` | Fixed; verified offline |
| 2 | Missing browser capabilities and incorrect permission queries | `mst.nfas`, `s162`, `s173`, `per` | Compared fields match offline on Android Chrome 152; backend/API limits below |
| 3 | Incorrect iframe Chrome surface and getter appearance | `dsi.ico`, `dsi.ift` | Fixed; compared fields match offline |
| 4 | Audio uses ID-derived values instead of matching captured evidence | `s158` | Ignored for now by user decision; research retained below |
| 5 | Plugin methods are incorrectly non-writable | `wsl` index 6 | Fixed; Android Chrome 152 overwrite probe succeeds |
| 6 | File input lacks the `capture` IDL attribute | `s150` | Fixed; Android Chrome 152 reflected attribute |
| 7 | Generated motion bypasses Chromium sensor quantization | `dme` | Fixed; generated motion emission uses Chromium 0.1 grid |

Audio remains ignored. There is no further active repair in this note.

Capability exposure and permission semantics are separate defects, grouped into
one repair stage because they share the navigator capability surface. Each
stage requires a real Realm execution and a check of the affected ABCK field;
tests or a successful cookie state alone do not prove parity.

## 1. Extension resource probes all succeed

- mimic bitmap: `1073741823,1073741823,3`.
- Real bitmap: `0,0,0`.
- The three words cover 62 extension-resource HEAD requests. All bits are set
  in mimic; none are set in real Chrome. The value before `|` is not an
  extension-presence bit.

Before stage 1, the offline fallback in `src/features/net.driver.ts` resolved
a minimal `Response` with `status=200` and `ok=true` regardless of URL scheme.
Workers in `src/features/dom.driver.ts` fall back to page fetch through their
`with(self)` scope, which also exposed this behavior to SharedWorker probes.

A baseline production Realm probe confirmed that both page and SharedWorker
HEAD requests to an absent `chrome-extension://.../missing.js` returned 200.

The shared offline fetch path now parses the URL against the document base
and rejects malformed URLs and unsupported schemes with a rejected Realm
Promise and `TypeError: Failed to fetch`, before capture recording. HTTP(S),
data and blob retain their prior behavior; live transport and available native
forwarding sources retain responsibility for their own URL handling.

Repair boundary: preserve existing HTTP(S) capture responses without sending
real network requests. Do not add extension IDs, ABCK-specific fields, or
supplier-specific exceptions to the network driver. This does not implement
full data/blob fetching or extension installation support.

## 2. Missing browser capabilities

| Field | mimic | Real Chrome | Meaning |
| --- | --- | --- | --- |
| `mst.nfas` | `26034616` | `30228925` | Three capability bits differ |
| `s162` | `111111` | `000000` | Six missing-capability flags; 1 means absent |
| `s173` | `0` | `1` | `ContentIndex` presence |

The `mst.nfas` XOR is `4194309`: bits 0, 2 and 22 correspond to
`navigator.credentials`, `navigator.bluetooth` and
`navigator.webkitTemporaryStorage`.

The six `s162` probes are `PublicKeyCredential`, `AuthenticatorResponse`,
`AuthenticatorAttestationResponse`, `AuthenticatorAssertionResponse`,
`MediaMetadata` and `navigator.mediaSession`. The baseline production Realm probe
confirmed all ten missing surfaces above.

Repair boundary: follow the existing Feature/Shape ownership and use browser
evidence for target-specific exposure. Do not hard-code payload bitmaps or
claim full WebAuthn, Bluetooth or media-session functionality merely by exposing
a constructor or object.

## 3. Permission queries ignore the permission name

- mimic completed result: `99999911919111111999`.
- Real completed result: `99999944949322244999`.

The query order is `speaker`, `device-info`, `bluetooth`,
`ambient-light-sensor`, `accelerometer`, `gyroscope`, `magnetometer`,
`clipboard`, `accessibility-events`.

Previously, `src/features/nav.compile.ts` resolved every query with
`{ state: 'prompt', onchange: null }`. Real Chrome rejects unsupported names
and distinguishes granted and denied states. Its accelerometer, gyroscope and
magnetometer queries return granted in this capture. All nine mimic queries
returned prompt in the baseline production Realm probe. The permission query
correction below replaces this constant binding with argument-aware behavior.

Repair boundary: distinguish invalid descriptors and unsupported permission
names from supported permissions and their states. Origin policy and user
grants cannot be inferred universally from one site's capture.

## 4. Iframe surface and native getter appearance

`dsi.ico` is the SHA-256 of the iframe Chrome object's enumerable own keys:

- mimic: `loadTimes,csi,app`, hash `070f409b82df3bdd2f51a6415c7895353c153c47fe6dd8a0f87f3d14c46ccb2b`.
- Real: `loadTimes,csi`, hash `b5b4950fcbc155e529ffb37ecd035deb7544874d291670dcb7632b336318fffd`.

Both hashes were reproduced exactly. Before stage 3,
`src/features/chrome.compile.ts` installed the extra `chrome.app` property for
this target.

The baseline `dsi.ift` is 2 in mimic and 3 in real. Both create a distinct iframe
Window, but the mimic `HTMLIFrameElement.prototype.contentWindow` getter printed
`function () { [native code] }` and fails the script's named-native-getter
check. This was reproduced in the production Realm.

Repair boundary: inspect the shared callable installation and its iframe
callers before editing. Preserve getter semantics and do not change global
native-function formatting solely to satisfy one regular expression. The
absence of `chrome.app` on this Android Chrome 152 capture must not be applied
blindly to other browser versions or desktop Chrome.

## 5. Audio values still come from the Profile ID

Status: ignored for now at the user's request. This is not fixed or validated
as browser-faithful, but is excluded from the current repair queue and subsequent
comparisons' actionable findings. No audio implementation or capture-data changes
were made during this research.

- mimic `s158`: `d4d77615`.
- Real `s158`: `37c4a1fb`.

This field hashes the ordered OfflineAudio result object containing
`reduction`, `sampleSum`, `freqSum` and `timeSum`. The mimic hash exactly matches
`synthesizeAudioFingerprint` for the captured phone Profile ID:

```json
{"reduction":0,"sampleSum":90.411766,"freqSum":-21082.353516,"timeSum":-0.003882}
```

The fp-env importer marks audio absent; the runtime therefore uses these
ID-derived sums despite the phone's separately saved audio capture.

Repair boundary: check the raw capture recipe, buffer size, parameters, units,
rounding and sum definitions before mapping audio into a normalized Profile.
The classic 5000-sample tail absolute sum is not interchangeable with the
ABCK four-tuple. Recollect matching measurements if necessary; do not replace
the runtime result with the real hash or infer raw samples from a hash.

### Audio research retained for later

Both archived original ABCK scripts were executed in the same phone-Profile
Realm with diagnostic observations inserted after audio measurement. They use
the same recipe and both produce the four-tuple above and `d4d77615` in mimic:

- `OfflineAudioContext(1, 44100, 44100)`: one channel, one second of audio.
- Triangle oscillator at 10000 Hz; compressor threshold/knee/ratio/attack/release
  of `-50 / 40 / 12 / 0 / 0.25`.
- `sampleSum` is the signed sum of all channel samples, not a tail or absolute sum.
- After rendering resolves, the script creates an analyser and buffer source in
  that same offline context. FFT size is 2048, frequency-bin count 1024; frequency
  and time samples are also summed without taking absolute values.
- The four measurements use six-decimal rounding followed by ordered JSON and
  the DJB2/XOR hash with seed 5381. Reducers do not filter nonfinite values:
  `-Infinity` would serialize as `null`, not zero. Whether the real tuple contains
  such a value is unmeasured; it cannot be inferred from `37c4a1fb`.

Current runtime probes confirm that a 44100-frame output has only one nonzero
sample, `90.4117660522461`. Triangle 10000 Hz, sine 440 Hz and a disconnected graph
all return the same array. Even `createBuffer()` receives this fill instead of
zeros. The analyser arrays use the same single-value aggregation shortcut.
Changing graph parameters therefore does not produce corresponding audio changes.

The phone's original `z__env_1788833327264.capture.json` contains 5000 native
samples. Its `124.08075415677013` measurement sums absolute values of frames
4500..4999; its full signed 5000-frame sum is `0.07146980640618494` and compressor
reduction is `-20.535268783569336`. These are not the longer ABCK recipe's inputs.
The current identity policy also casts aggregate values to Float32 for single-point
replay, which can alter a real double-precision aggregate before six-decimal
rounding. Merely importing four measurements would not address that issue.

Risk assessment: the uploaded hash does not directly expose the sparse waveform
or uniquely identify its four inputs. A service could compare audio hashes with
real-browser distributions and other environment fields, but its actual scoring
rules, this hash's acceptance and a causal link to edge 403 are unknown. The
observed runtime defect is not proof that this field caused a block.

If explicitly reopened, first collect the identical recipe and call sequence,
including raw PCM, analyser arrays, reduction, parameters and browser provenance.
A scoped repair could normalize those records into Profile/Plan and replay exact
arrays for the measured configuration, leaving aggregation and hashing to the
original script. Do not overwrite `s158`, infer samples from its hash, distribute
one phone's evidence across all Profiles, or claim a complete DSP implementation.
This is a deferred direction, not an implemented change or a current task.

## Post-repair payload comparison

The subsequent tfdev capture contains fourteen flows, including five ABCK POSTs
at IDs 4-8. Complete fingerprint fields are compared from IDs 6-8, decoded with
`fileHash=6828387`, against the same twenty real exports and reference flow 108.
These flow IDs refer to this capture, not a permanent tfdev identifier space.

This run uses `android-chrome/sm-f956b-v152-1776955`, a Samsung Profile, whereas
the real reference is the M2012K11AC. Screen size, DPR, GPU and OS-version
differences are therefore not defects by themselves. Continue to exclude flow,
regional and timing differences, and the explicitly ignored `s158`.

The latest complete payloads match real on all previously repaired fields:
`sww.ext=0|0,0,0`, `mst.nfas=30228925`, `s162=000000`, `s173=1`,
`per=99999944949322244999`, `dsi.ico=b5b4950f...18fffd` and `dsi.ift=3`.
The three remaining defects below were investigated without implementation
changes or new supplier requests.

Flow 6, the third ABCK POST, sets `_abck` to `~0~`. Flow 13 sends that cookie
but receives HTML Access Denied, HTTP 403. This is not a missing-final-sensor
outcome, but it does not establish which, if any, of these defects caused the
edge block.

## 6. Plugin methods are incorrectly non-writable

Status: fixed for Android Chrome 152.

- `wsl` zero-based index 6 (the seventh comma-separated item): mimic `-1`, real `1`.
- Both scripts probe whether `navigator.plugins.refresh` can be temporarily
  replaced with a string, then restore the original function. A successful
  overwrite returns `1`; an exception returns `-1`.
- Before the fix, the Realm exposed the method as `writable:false`.
  Strict-mode assignment threw `TypeError: Cannot assign to read only property
  'refresh' of object '[object PluginArray]'`.

Two paths enforced that lock: `src/features/plugins.compile.ts` declared
PluginArray/MimeTypeArray/Plugin methods non-writable, and
`src/features/plugins.driver.ts` called `lockArrayMethods()` on first navigator
access and deleted own overrides.

Android Chrome 152 compiles those methods writable, without re-locking them on
first access. Older stored Shapes retain their non-writable ops unchanged.
The 152 Realm overwrite probe now returns `1` without throwing. Plugin counts
and `wsl` encoding were not hard-coded.

## 7. File input lacks the capture IDL attribute

Status: fixed for Android Chrome 152.

`s150` is a randomized capability encoding, not an arbitrary random field or
a directly comparable magnitude. Both audited scripts create an input, set
`type=file` and `capture=user`, then test whether `input.capture` is defined.
The encoding was checked through diagnostic observations after computation:
support produces a random multiple of 862; absence produces a nonmultiple.

- Latest mimic before the fix: `7470 % 862 = 574`, meaning absent.
- Real reference: `65512 % 862 = 0`, meaning present.
- Every nonempty `s150` across the twenty real exports is a multiple of 862.
- Before the fix, `getAttribute('capture')` returned `user`, but
  `input.capture` was undefined and `HTMLInputElement.prototype` had no
  `capture` descriptor.

Android Chrome 152 now exposes a reflected `capture` accessor through the DOM
Feature/Shape path. `setAttribute('capture','user')` yields `input.capture ===
'user'`; a missing attribute yields `''`; a non-input receiver throws
`TypeError`. `s150` is not hard-coded, and this does not implement camera
capture. Recheck the encoding constants for future script versions instead of
assuming that 862 is universal. Other targets remain unchanged.

Receiver validation uses the saved native input `type` getter instead of
`instanceof`: cross-Realm inputs and inputs with modified JS prototypes remain
usable, while forged objects are rejected. Attribute access uses functions saved
at Driver installation, so page overrides cannot redirect it. The native setter
handles DOMString conversion.

## 8. Generated motion bypasses Chromium sensor quantization

Status: fixed at generated sensor emission.

The latest `dme` contained values such as `-0.01`, `7.21` and `20.26`, whereas
the real samples lie on a 0.1 grid. Counts exclude event indices and timestamps:

| Sample | Motion numbers | Numbers off the 0.1 grid |
| --- | --- | --- |
| Latest complete payload before the fix | 90 | 84 |
| All real exports, deduplicated to fourteen motion rows | 126 | 0 |

The same ten motion rows occur in flows 6-8; these are not three independent
samples. This is also not merely inferred from different phone hardware:
[Chromium's sensor constants](https://raw.githubusercontent.com/chromium/chromium/main/services/device/generic_sensor/platform_sensor_util.h)
specify privacy rounding of acceleration, gravity and linear acceleration to
0.1 m/s^2, and gyro readings to `0.00174532925199432963` rad/s, equivalent to
0.1 deg/s. `platform_sensor_util.cc` implements nearest-multiple rounding with
half ties away from zero.

`src/interaction/dispatch.ts` now applies that 0.1 grid, with half ties away
from zero, to generated acceleration, accelerationIncludingGravity and
rotationRate (already deg/s) when emitting DeviceMotionEvent. rotationRate keeps
the `alpha`/`beta`/`gamma` keys required by jsdom's DeviceMotionEvent
constructor; using `x`/`y`/`z` leaves those components null. Joint samples and
model precision are unchanged; page-created events are not quantized. A probe
with the previously off-grid values `-0.01`, `7.21` and `20.26` emitted nine
on-grid numbers, while raw synthesized frames remained off-grid. This does not
claim full physical fidelity or explain the edge 403.

## Verification log

- Baseline: page and SharedWorker extension HEAD probes resolve 200; all ten
  listed capability surfaces are absent; all nine permission queries return
  prompt; iframe Chrome keys and unnamed getter match the exported differences.
- No supplier requests were sent during baseline verification.
- Online acceptance and the cause of any edge 403 remain unproven.

### Stage 1 results

- The new net regression covers capture and run modes, extension URL strings
  and URL objects, mixed-case schemes, other unsupported schemes and malformed
  URLs. Failures are Realm Promises containing Realm TypeErrors and do not
  appear in captured requests. Relative and absolute HTTP(S) POSTs still return
  the existing minimal success response and retain their captured bodies.
- Production phone-Profile probes in the page, Worker and SharedWorker all
  reject an absent extension resource with `TypeError: Failed to fetch`.
  A subsequent HTTP sensor POST succeeds and is the only recorded request.
- Running the archived, unmodified ABCK source and page through `captureBodies`
  produces eleven non-empty bodies with the seeded interaction enabled.
- A separate execution of that same unmodified ABCK source, observed through
  a temporary host-side Worker message hook, produces `ext: "0|0,0,0"`.
  The observation does not change the script or patch browser-visible APIs.
  This verifies the extension result before sensor encoding; it is not a
  re-decryption of the new encrypted bodies or an online acceptance check.
- Net and Worker tests pass (6 + 4). The first combined closed-loop test run
  exceeded its command deadline after four results; the isolated watchdog test
  and the complete eleven-test closed-loop file pass on rerun. No related
  timeout logic was changed.
- Type checking and the production build pass. Stage 1 changes only offline
  fetch handling; all other stages remain pending.
- Default parallel full-suite execution was not clean. A raw TAP rerun reports
  329 passes and two Cebu harness failures reading missing `dist/assets/probe.js`
  and `dist/src/public.js`. A serial full-suite run passes all 331 tests with
  zero failures:

  ```sh
  node --test --test-concurrency=1 --test-timeout=45000 build/test/test/*.test.js
  ```

  This is consistent with shared build-artifact interference, but its source
  has not been established. No unrelated build or harness code was modified.

### Stage 2: permission query correction

The preceding flow and offline-fetch changes were committed as `a3c5b35` before
this stage. Permission-query behavior is handled independently of capability
exposure; the missing WebAuthn, Bluetooth, storage and media surfaces remain
pending rather than being replaced with empty objects.

Additional evidence was collected from the connected M2012K11AC, Chrome
152.0.7977.75, using a USB-only localhost page in a secure context. The capture
includes constructor/prototype descriptors, navigator getter signatures,
permission-name queries and invalid-descriptor results. No prompts, credential
requests or Bluetooth device selection were invoked.

- Local artifact: `profiles/_fp-env/android_152/z__env_1788833327264.capabilities.capture.json`.
- Capture SHA-256: `728a83fd6cc169940a54dff1f5afb5e4d265e9172e5c98d0fb7ced5a710a8d2e`.
- This artifact is Git-ignored and does not replace or alter the original fp-env
  record. Temporary USB reverse mappings and the local server were removed.

`navFeature` revision 5 binds `permissions.query` to a dedicated operation in
`nav.driver.ts`; other navigator operations still delegate to the existing data
driver. The query reads its descriptor synchronously, including inherited
properties and string conversion, but returns invalid receiver, argument and
permission-name errors through a Realm Promise. Page-thrown descriptor errors
are preserved. Unsupported names and disabled features have distinct errors.

The operation returns modeled Chromium default states instead of a universal
prompt, including granted motion-sensor permissions and Android-specific
restrictions. It also distinguishes required push/fullscreen descriptor flags
and clipboard writes without a gesture. These are emulated defaults, not an
origin's recorded grants. `permissions.data` now describes partial behavior,
while its provenance remains `emulated`.

Verification:

- Ten navigator/UA tests pass, including three new query regressions for the
  nine compared names, Realm errors, descriptor conversion timing, fresh result
  snapshots and platform/descriptor branches.
- The archived original ABCK script was run twice with the same phone Profile
  and page, once with the old constant-query behavior and once with the new
  operation. A diagnostic event was inserted after its permission-string
  assignment, without changing query or encoding logic. Results were exactly
  `99999911919111111999` before and `99999944949322244999` after, matching the
  original mimic and real exports respectively.
- This observes the value before encryption. It is not a new-body decryption
  or an online acceptance check; no supplier requests were sent.
- Type checking, production/test builds and the thirteen-shape reproducibility
  check pass. Generated Shape files did not change.
- The complete existing suite was run serially with a 45-second per-test
  timeout: 334 tests passed, zero failed, process exit code 0.

Remaining boundaries:

- Result objects still use the existing lightweight Realm `{ state, onchange }`
  representation, not a full `PermissionStatus` EventTarget. Real Chrome's
  additional name accessor, branding, readonly state and change-event behavior
  were captured but are not implemented by this correction.
- Saved user grants, Permissions-Policy, delegated iframe policy and dynamic
  permission changes are not modeled. In particular, default granted states
  must not be described as known grants for every origin.
- The default table and platform restrictions are not a captured behavior matrix
  for every browser version. The direct phone comparison covers Chrome 152;
  unmeasured configurations remain emulated.
- At the end of the permission correction, Android Chrome still selected the
  WebView member table and some capability getters remained unbound. The
  target-specific capability correction follows below.

### Stage 2: capability correction for Android Chrome 152

The ten compared missing surfaces are now installed for
`host=chrome, platform=android, version=152`. Other versions, desktop Chrome and
WebView retain their previous behavior. The remaining generic DOM fallback is
not replaced wholesale with a desktop Chrome table.

`nav.capabilities.compile.ts` contributes these interfaces through the existing
nav Shape/Feature, with nav revision 6 binding their operations to the nav driver.
Runtime code does not load the collector-private JSON. Implemented navigator
getters take ownership before the generic missing-member pass; this target's
modeled navigator members follow the captured key order. Unmodeled members are
retained, not silently removed or advertised as newly implemented.

- WebAuthn interfaces have named constructors, prototype inheritance, accessors
  and methods. Non-public constructors reject construction. Credentials,
  Bluetooth and ContentIndex coverage is explicitly structural, not a working
  authenticator, device connection or content-index service. Unsupported backend
  calls reject/throw `NotSupportedError`; they do not fabricate credentials or
  successful device operations.
- Navigator objects are stable, prototype-backed and branded. Bluetooth inherits
  EventTarget. The two legacy quota objects have a `DeprecatedStorageQuota`
  prototype without inventing a global constructor that Chrome does not expose.
- Legacy quota callbacks are asynchronous and use the same 10 GiB quota as the
  existing StorageManager model. Temporary and persistent accessors remain
  distinct objects; this is not persistent disk storage.
- MediaMetadata implements title/artist/album updates, URL-resolved artwork and
  fresh frozen snapshots. MediaSession retains local metadata, playback state
  and action handlers. It does not control system media playback or device
  camera/microphone state. Nonempty chapter information and position-state
  emulation remain unsupported; cross-Realm borrowing of metadata objects is
  not modeled.

Additional USB-only evidence for constructor errors, navigator order, quota
callbacks and media defaults is stored in the Git-ignored file
`profiles/_fp-env/android_152/z__env_1788833327264.interfaces.capture.json`.
SHA-256: `c6e4f8638501a280fc288503947748c633c74c8b6952e4628c92c4b196226797`.
The original fp-env record and earlier evidence artifacts are unchanged.

Verification (no tests added in this stage):

| Field | Before | After | Real export |
| --- | --- | --- | --- |
| `mst.nfas` | `26034616` | `30228925` | `30228925` |
| `s162` | `111111` | `000000` | `000000` |
| `s173` | `0` | `1` | `1` |

- The archived original ABCK script produced these values with diagnostic events
  inserted after their computation. Probe logic was unchanged. This observes
  pre-encryption values, not a re-decryption or online acceptance result.
- The first observation disposed the Realm immediately after the synchronous
  values arrived, leaving an asynchronous script continuation that attempted to
  call a released timer binding. Repeating with the asynchronous phase allowed
  to finish exited cleanly with zero active Realms; no timer code was changed.
- The completely unmodified original script also ran through the shared
  `captureBodies` Worker path with seeded interaction: 11 nonempty bodies,
  12 total recorded posts, clean completion, and no supplier requests.
- Direct Realm execution verified constructor rejection, getter branding,
  metadata updates/frozen artwork, quota callbacks and unsupported backend
  errors. A child iframe has separate constructors, prototypes and media state;
  objects created inside it retain the child Realm's types.
- Production build, type checking, data validation and the thirteen-shape
  reproducibility check pass. Those existing Shape artifacts are unchanged.
  No test files were added or modified in this stage, and the full test suite
  was not rerun.

### Stage 3: iframe Chrome surface and getter Realm identity

`chromeFeature` revision 4 omits `chrome.app` for Android Chrome 152. The same
target predicate controls its object/method allocations, property order and
four driver bindings, so no references to removed function slots remain.
`loadTimes` and `csi` retain their existing implementations and anonymous native
function signatures. Other Chrome targets retain the existing app surface.

The getter failure was a Realm identity error, not an incorrect function name.
Before the fix, both iframe getters already had the correct name and a registered
named native source. However, their Proxy targets were jsdom's host functions:

- `getter instanceof window.Function` was false.
- `getter.toString()` used the inherited host intrinsic and returned
  `function () { [native code] }`.
- `window.Function.prototype.toString.call(getter)` already returned the named
  native source.

`Installer.bootChildRealms()` now creates each Proxy with a target-Realm getter
as its target, while its apply handler continues to delegate to the original
jsdom getter and install the returned child Realm. This fixes `contentWindow`
and `contentDocument` together. It does not change global native formatting,
relax the script's check or overwrite jsdom's original function prototype.

Verification (no tests added or modified in this stage):

| Field | Before | After / real export |
| --- | --- | --- |
| `dsi.ico` | `070f409b82df3bdd2f51a6415c7895353c153c47fe6dd8a0f87f3d14c46ccb2b` | `b5b4950fcbc155e529ffb37ecd035deb7544874d291670dcb7632b336318fffd` |
| `dsi.ift` | `2` | `3` |

- The archived original ABCK script produced these values with one diagnostic
  event inserted after both computations; neither probe nor encoding logic was
  changed. This observes pre-encryption values, not newly decrypted bodies or
  an online acceptance result. The Realm exited with zero active instances.
- The completely unmodified script also completed through the shared
  `captureBodies` Worker path with seeded interaction: 11 nonempty bodies and
  12 total recorded posts. No supplier requests were sent.
- Direct execution checked the page, child and nested iframe Realms and the
  existing detached-frame path. Getters now inherit their own Realm's
  Function.prototype; direct, own-Realm and parent-Realm stringification agree.
  Names, lengths, own keys, descriptor flags, non-constructibility and invalid
  receiver TypeErrors are preserved. Window/document access, named/indexed frame
  access and separate Chrome objects remain intact.
- All 39 existing Chrome/touch, Engine, security, time and environment tests pass
  in serial execution. The full suite was not rerun.
- Production/test builds, type checking, data validation and the thirteen-shape
  reproducibility check pass. Existing generated Shape files are unchanged.

The existing detached-frame auto-parenting workaround, navigation handling and
cross-origin access behavior were not changed or newly claimed as browser-faithful.
Audio evidence for `s158` remains uncorrected but is now explicitly ignored by
user decision; its research and possible future scope are recorded in section 5.

### Stages 5-7: plugin writability, input.capture, motion quantization

These three repairs were implemented together after the latest payload
comparison. No new tests were added. No supplier requests were sent.

- Profile `android-chrome/m2012k11ac-v152-1788833327264` ran the ABCK overwrite
  itself under `'use strict'`: `navigator.plugins.refresh = 'x'` succeeded and
  restored. `setAttribute('capture','user')` yielded `input.capture === 'user'`;
  a missing attribute yielded `''`; a non-input receiver threw `TypeError`.
- The WebView 138 fixture kept `refresh` non-writable. Strict assignment threw
  `TypeError: Cannot assign to read only property 'refresh'`. `input.capture`
  stayed undefined while `getAttribute('capture')` still stored `user`.
- Generated DeviceMotionEvent emission of `-0.01`, `7.21` and `20.26` produced
  nine on-grid values, including rotationRate. A live 152 Realm swipe emitted
  on-grid acceleration, gravity and rotationRate. A 16-frame synthesized swipe
  still had 143 of 144 raw numbers off the 0.1 grid, so model precision was not
  collapsed.
- Production/test builds, type checking and `git diff --check` pass. The
  thirteen-shape reproducibility check reports `changed: false`.
- Focused plugins, interaction, DOM, navigator/UA, Application and runtime-task
  tests pass (42). A serial full-suite run passes 334 tests.

### Stage 6 review follow-up

- The Android Chrome 152 phone Profile passed 34 live Realm checks covering
  bidirectional parent/iframe calls, detached-iframe inputs, changed input
  prototypes and rejection of forged/non-input receivers. Accessors remain
  functional after own/prototype method overrides or global HTMLInputElement
  constructor replacement.
- Reflection preserves missing/removal behavior and raw string values.
  DOMString conversion occurs once; Symbol assignment throws a Realm TypeError
  without changing the stored attribute. Realm disposal leaves zero active
  instances.
- Production/test builds, type checking and the 23 existing DOM, plugins,
  interaction and runtime-task tests pass. The thirteen-shape reproducibility
  check reports `changed: false`.
- This follow-up changes only the DOM Driver and this note. No new tests,
  full-suite rerun, ABCK-script rerun or supplier requests were added; plugin
  writability and motion quantization remain unchanged.
