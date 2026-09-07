import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createMimic } from '../dist/src/sdk.js';
import { digest, seal } from '../dist/src/core/seal.js';

const fixture = JSON.parse(await readFile(process.argv[2] || new URL('../test/fixtures/layout-browser.json', import.meta.url), 'utf8'));
const records = [];
for (const record of fixture.records) {
  const client = createMimic({
    profile: 'android-webview/unknown-v138-1',
    profilesRoot: fileURLToPath(new URL('../test/fixtures/fp-env', import.meta.url)),
    size: 1, timeoutMs: 15_000,
    page: seal({ schema: 2, id: 'layout-probe', source: { kind: 'manual', hash: digest(record.html) },
      url: 'https://layout.test/', html: record.html, layout: record.layout }),
    capture: { deadlineMs: 9_000, pollMs: 10, maxPosts: 5 },
  });
  try {
    assert.deepEqual((await client.plan({ kind: 'capture', code: '' })).boot.layout, record.layout);
    const result = await client.capture({ kind: 'capture', interaction: { adapter: 'akamai-sensor', seed: 'layout-probe' }, code: `
      (${fixture.observer})(${JSON.stringify(record.mode)});
      const before = scrollProbe.snapshot('before');
      const box = document.getElementById('box');
      if (box) box.scrollTop = ${record.after.boxScrollTop ?? 0};
      scrollTo(0,600);
      const explicit = scrollProbe.snapshot('after-scrollTo');
      scrollTo(0,0);
      if (box) box.scrollTop = 0;
      document.addEventListener('touchend', () => {
        navigator.sendBeacon('/evidence', JSON.stringify({ before, explicit, rows: scrollProbe.rows, after: scrollProbe.snapshot('after-touchend') }));
      });
    ` });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.posts.length, 3);
    const capture = JSON.parse(result.value.posts.at(-1).body);
    assert.deepEqual(capture.before, record.before);
    assert.deepEqual(capture.explicit, record.explicit);
    for (const row of capture.rows) {
      assert.equal(row.scrollY, row.root.scrollTop);
      assert.equal(row.scrollY, row.visual.pageTop);
      if (row.type === 'touchstart') assert.equal(row.target, row.hit);
      if (row.clientY !== null) {
        assert.equal(row.pageY, row.clientY + row.scrollY, row.type);
        assert.equal(row.screenY, row.clientY + record.layout.viewport.screenOffsetY);
        assert.equal(row.screenX, row.clientX + record.layout.viewport.screenOffsetX);
      }
    }
    const blocked = record.mode === 'touch-action-none' || record.mode === 'prevent-touchmove';
    assert.equal(capture.after.scrollY > 0, record.mode === 'root');
    assert.equal((capture.after.boxScrollTop ?? 0) > 0, record.mode === 'nested');
    assert.equal(capture.rows.filter(row => row.type === 'pointercancel').length, blocked ? 0 : 2);
    records.push({ mode: record.mode, plan: result.plan, posts: result.value.posts.length,
      scrollY: capture.after.scrollY, containerTop: capture.after.boxScrollTop,
      targets: capture.rows.filter(row => row.type === 'touchstart').map(row => row.target),
      checkedEvents: capture.rows.length });
  } finally { await client.close(); }
}
console.log(JSON.stringify({ status: 'passed', source: fixture.kind, records }, null, 2));
