# Test Evidence

`identities.json` contains nine normalized identity snapshots retained from the
retired device library for existing feature and golden-oracle regression tests.
Their source hashes are preserved; they are not selectable runtime devices.

`collect-identity.json` and `collect-macos-identity.json` are the WebView 138 and
macOS Chrome 148 identity captures paired with existing structural baselines for
collect tests.

`fp-env/_fp-env/android_138/z__env_1.json` is a test-only format conversion of that
WebView capture, not a downloaded fp-env record. SDK, CLI, HTTP and executor tests
use it to exercise the sole runtime data-loading path without private downloads.

None of these files are shipped in the npm package.
