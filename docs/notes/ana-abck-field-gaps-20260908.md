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
| 2 | Missing browser capabilities and incorrect permission queries | `mst.nfas`, `s162`, `s173`, `per` | Pending |
| 3 | Incorrect iframe Chrome surface and getter appearance | `dsi.ico`, `dsi.ift` | Pending |
| 4 | Audio uses ID-derived values instead of matching captured evidence | `s158` | Pending |

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
`MediaMetadata` and `navigator.mediaSession`. A current production Realm probe
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

`src/features/nav.compile.ts` currently resolves every query with
`{ state: 'prompt', onchange: null }`. Real Chrome rejects unsupported names
and distinguishes granted and denied states. Its accelerometer, gyroscope and
magnetometer queries return granted in this capture. All nine mimic queries
returned prompt in the production Realm probe.

Repair boundary: distinguish invalid descriptors and unsupported permission
names from supported permissions and their states. Origin policy and user
grants cannot be inferred universally from one site's capture.

## 4. Iframe surface and native getter appearance

`dsi.ico` is the SHA-256 of the iframe Chrome object's enumerable own keys:

- mimic: `loadTimes,csi,app`, hash `070f409b82df3bdd2f51a6415c7895353c153c47fe6dd8a0f87f3d14c46ccb2b`.
- Real: `loadTimes,csi`, hash `b5b4950fcbc155e529ffb37ecd035deb7544874d291670dcb7632b336318fffd`.

Both hashes were reproduced exactly. `src/features/chrome.compile.ts` installs
the extra `chrome.app` property for this target.

`dsi.ift` is 2 in mimic and 3 in real. Both create a distinct iframe Window,
but the mimic `HTMLIFrameElement.prototype.contentWindow` getter prints
`function () { [native code] }` and fails the script's named-native-getter
check. This was reproduced in the production Realm.

Repair boundary: inspect the shared callable installation and its iframe
callers before editing. Preserve getter semantics and do not change global
native-function formatting solely to satisfy one regular expression. The
absence of `chrome.app` on this Android Chrome 152 capture must not be applied
blindly to other browser versions or desktop Chrome.

## 5. Audio values still come from the Profile ID

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
