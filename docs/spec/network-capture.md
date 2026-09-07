# Opt-in Network Capture

Closed-loop capture is an explicit SDK execution option. The default remains
offline request-body capture. This is a bounded HTTP response-feedback facility,
not a complete browser network stack or a security sandbox.

```ts
const mimic = createMimic({
  profile,
  page,
  timeoutMs: 15_000,
  capture: { deadlineMs: 8_000, maxPosts: 14 },
  network: {
    allowedUrls: ['https://example.test/sensor'],
    cookies: [{ url: 'https://example.test/', value: 'sid=initial; Path=/; HttpOnly' }],
    request: request => fetch(request),
  },
});
try {
  await mimic.capture({ kind: 'capture', code: script });
} finally {
  await mimic.close();
}
```

## Transport Contract

- `network.request` executes only in the host. It receives a native Request
  with the method, headers, buffered body, `redirect: 'manual'` and AbortSignal.
  Return a native Response, including individual Set-Cookie headers. Honor the
  provided Cookie header rather than silently merging another cookie jar.
- The transport must not follow redirects itself and must honor cancellation.
  The bridge rejects a mismatching Response URL, but cannot undo I/O performed
  by a misconfigured trusted host callback.
- Every HTTP(S) URL, including redirect and preflight targets, must match the
  explicit allowlist. Query strings are significant; fragments are removed.
  URL credentials, wildcard targets and non-HTTP protocols are not accepted.
- Request and response bodies crossing the bridge are limited to 8 MiB each.
  Response streams are read with cancellation and a size bound. Bodies are
  buffered, not incrementally delivered into the Realm. This is not an overall
  process memory budget or an upload allocation bound inside jsdom/freq-js.
- `cookies` supplies raw response-cookie values with their source URLs. Optional
  `receivedAt` records the original receipt time for relative expiry. Domain,
  Path, Secure and HttpOnly remain CookieJar responsibilities. Existing Page
  boot cookies still apply; do not put HttpOnly values in flattened Page cookies.

## Execution Boundary

Each execution transfers a fresh MessagePort to the worker. The host owns I/O
and cancellation; the worker owns jsdom XHR events, CORS, redirects and cookies.
Same-origin iframe requests share the task's transport and CookieJar. No network
connection object or callback enters the Plan, Job, v2 JSON wire or Realm.

The net Driver delegates asynchronous XHR to jsdom. Its fetch helper uses XHR
for buffered responses and supports status, statusText, ok, url, read-only
headers, bodyUsed, text, json and arrayBuffer. Beacon returns immediately while
its request remains in flight. HTTP errors such as 403 remain browser responses;
transport/CORS/allowlist errors use the browser error/rejection path.

`report.net.pending` is present only in closed-loop captures. Reaching maxPosts
or the interaction settle threshold does not close a task while requests remain
in flight. Deadline expiration with pending requests fails the capture. Task
completion, failure, worker exit, watchdog and explicit close cancel host I/O.
Explicit close retains the SDK's existing rejection of pending executions.
maxPosts is an observed completion threshold, not a strict network request quota.

Installation Plan identity, Engine ABI and offline reports are unchanged.
Transport is a task-local host capability in the private worker protocol. Static
Plan capability reports describe installation, not this execution option or an
authorization to access the network. A network-configured client rejects run
jobs; list and plan remain lazy and do not open the transport.

## Limits

- Synchronous XHR is rejected: jsdom's synchronous helper bypasses interceptors.
- Element subresources remain disabled, including file/data resource loading.
  Protocol upgrades, including WebSocket, are rejected. Non-HTTP XHR is blocked
  before jsdom can enter its file/data paths outside the HTTP interceptor.
- Fetch Request inputs, streaming request bodies, credentials=omit, no-cors and
  non-follow redirect modes are rejected. Response streams, cloning, Blob/FormData
  response readers and a full Headers/Response WebIDL implementation are absent.
- jsdom 29 begins redirect hops before body-end cookie storage. The closed-loop
  adapter commits buffered redirect cookies before following, using the same
  origin, credentials and preflight conditions. No dependency files are patched.
- No persistence of a Realm, JavaScript state, storage or script-written cookies
  across distinct capture calls is implied. Host transports that ignore abort
  cannot be forcibly cancelled by an AbortSignal.

## ANA Integration

`runAnaFlow({ networkMode: 'closed-loop', ... })` enables response feedback for
each ABCK/BMS capture. Omit the option, or use `offline`, for the existing subset
posting policy. Closed-loop sends requests as generated and never re-posts the
captured bodies afterward. `postCount` is rejected in closed-loop mode because
future tail selection cannot coexist with immediate response feedback.

The ANA adapter uses the existing freq-js wire profile and proxy session,
preserves cookie attributes from initial GET responses (including approved
redirect hops), and forwards manual responses. Sensor endpoints must be on the
capture page's origin. Only the discovered sensor URL and its query-free variant
are allowed for that capture; other targets fail rather than widening the policy.
Initial-page redirect hops are restricted to HTTPS ANA subdomains and ten hops.

ABCK and BMS still use separate Realms. Server response cookies seed the later
capture, but arbitrary ABCK JavaScript state and script-only cookie edits do not.
`abckPostCount` counts completed POST responses, not challenge acceptance. Capture
body count, cookie markers and final business responses remain distinct results.
No live ANA acceptance or complete browser-equivalence claim follows from local
closed-loop tests.

## Verification

`test/network-capture.test.ts` exercises actual workers, local HTTP and the real
freq-js ANA transport: response callbacks, HttpOnly/Path behavior, iframe requests,
redirect checks and cookies, HTTP failures, CORS preflight/credentials, worker
reuse, deadline/watchdog/close cancellation and response-stream cancellation.
`test/ana-flow.test.ts` runs the compiled supplier flow against local adapters,
including closed-loop forwarding without offline replay and option validation.

Verification checkpoint: 292/292 tests passed; type, Shape and data checks passed.
All 2026 existing Plan identities, Shape hashes and operation digests were
unchanged. The existing resource gate passed; closed-loop cancellation checks
also ended with no live worker. Long-running closed-loop memory stability and
live supplier acceptance remain unverified.
