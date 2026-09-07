import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import fixture from './fixtures/layout-browser.json' with { type: 'json' };
import { checkLayout } from '../src/core/layout.js';
import { parsePage } from '../src/core/parse.js';
import { parsePlan } from '../src/compile/parse.js';
import { digest, seal } from '../src/core/seal.js';
import { createNodePlanner } from '../src/node/planner.js';
import { FixtureProfiles } from './fixtures.js';
import { createNodeRuntime } from '../src/node/runtime.js';
import { JsdomEngine } from '../src/engine/jsdom.js';
import type { Port, Runtime } from '../src/engine/types.js';
import type { InteractionFrame } from '../src/interaction/types.js';
import { createInteractionSource } from '../src/interaction/dispatch.js';
import { prepareExecution } from '../src/runtime/task.js';
import { drivers } from '../src/features/drivers.js';

const profile = 'android-webview-v138';
const job = { kind: 'run' as const, code: '0' };
const planner = createNodePlanner({ profiles: new FixtureProfiles() });
type Snapshot = typeof fixture.records[number]['before'];
type Row = Snapshot & {
  type: string; target: string; trusted: boolean;
  clientX: number | null; clientY: number | null;
  pageY: number | null; screenX: number | null; screenY: number | null;
};
function page(mode: string) {
  const record = fixture.records.find(record => record.mode === mode)!;
  const layout = structuredClone(record.layout);
  checkLayout(layout);
  return seal({ schema: 2 as const, id: `layout-${mode}`, source: { kind: 'manual' as const, hash: digest(record.html) },
    url: 'https://layout.test/', html: record.html, layout });
}
async function evaluate<T = unknown>(runtime: Runtime, expression: string): Promise<T> {
  const result = await runtime.run(`JSON.stringify((${expression}))`);
  assert.ok(result.ok, JSON.stringify(result));
  return JSON.parse(result.value as string) as T;
}
const touch = (phase: 'start' | 'move' | 'end', at: number, y: number): InteractionFrame => ({
  kind: 'touch', phase, at, x: 190 / 393, y: y / 748,
  radiusX: .01, radiusY: .01, force: .5,
});

test('Page overlay inherits layout only while HTML and URL remain unchanged', async () => {
  const profiles = new FixtureProfiles();
  const inherited = page('root');
  const inheritedPlanner = createNodePlanner({ profiles: {
    list: () => profiles.list(),
    load: async id => ({ ...await profiles.load(id), page: inherited }),
  } });
  const override = { schema: 2 as const, id: 'override', source: { kind: 'manual' as const, hash: digest('override') } };
  const unchanged = await inheritedPlanner.plan({ profile, job, page: seal({ ...override, cookies: ['a=1'] }) });
  assert.deepEqual(unchanged.boot.layout, inherited.layout);
  for (const update of [{ html: '<body></body>' }, { url: 'https://changed.test/' }]) {
    await assert.rejects(inheritedPlanner.plan({ profile, job, page: seal({ ...override, ...update }) }), { code: 'BAD_PAGE' });
  }
});
const swipe = [touch('start', 0, 550), ...Array.from({ length: 12 }, (_, index) => touch('move', (index + 1) * 4, 550 - (index + 1) * 22)), touch('end', 55, 286)];

test('layout snapshot survives Page overlay, Plan serialization and capability inspection', async () => {
  const supplied = page('root');
  const { plan, capabilities } = await planner.inspect({ profile, page: supplied, job });
  assert.deepEqual(plan.boot.layout, supplied.layout);
  assert.deepEqual(parsePlan(JSON.parse(JSON.stringify(plan))), plan);
  assert.equal(capabilities.entries['view.data']?.coverage, 'partial');
  assert.equal(capabilities.entries['view.data']?.origin, 'mixed');
  const { hash: _hash, ...changed } = structuredClone(supplied);
  changed.layout.root.top = 10;
  assert.notEqual((await planner.plan({ profile, page: seal(changed), job })).id, plan.id);
  assert.throws(() => parsePage(seal({ ...changed, layout: { ...changed.layout, paintOrder: [0, 0] } })), { code: 'BAD_PAGE' });
  const malformed = JSON.parse(JSON.stringify(plan));
  malformed.boot.layout.root.top = 10_000;
  assert.throws(() => parsePlan(malformed), { code: 'BAD_PLAN' });
});

for (const record of fixture.records) {
  test(`layout ${record.mode} matches independently captured Chrome geometry and keeps input coordinates coherent`, async () => {
    const plan = await planner.plan({ profile, page: page(record.mode), job });
    const engine = new JsdomEngine();
    const runtime = engine.open(plan, drivers);
    try {
      assert.ok((await runtime.run(`(${fixture.observer})(${JSON.stringify(record.mode)})`)).ok);
      assert.deepEqual(await evaluate(runtime, 'scrollProbe.snapshot("before")'), record.before);
      if (record.mode === 'nested') {
        assert.ok((await runtime.run(`document.getElementById('box').scrollTop=${record.after.boxScrollTop}`)).ok);
      }
      assert.ok((await runtime.run('scrollTo(0,600)')).ok);
      assert.deepEqual(await evaluate(runtime, 'scrollProbe.snapshot("after-scrollTo")'), record.explicit);
      assert.ok((await runtime.run('scrollTo(0,0)')).ok);
      if (record.mode === 'nested') assert.ok((await runtime.run('document.getElementById("box").scrollTop=0')).ok);
      await delay(10);
      assert.ok((await runtime.run('scrollProbe.rows.length=0')).ok);
      assert.ok((await runtime.run(createInteractionSource(swipe), { trustedEvents: true })).ok);
      await delay(100);
      assert.ok((await runtime.run(createInteractionSource([touch('start', 0, 550), touch('end', 5, 550)]), { trustedEvents: true })).ok);
      await delay(30);
      const { state, rows } = await evaluate<{ state: Snapshot; rows: Row[] }>(runtime, '({state:scrollProbe.snapshot("after"),rows:scrollProbe.rows})');
      const blocked = record.mode === 'touch-action-none' || record.mode === 'prevent-touchmove';
      assert.equal(state.scrollY > 0, record.mode === 'root');
      assert.equal((state.boxScrollTop ?? 0) > 0, record.mode === 'nested');
      assert.equal(rows.filter(row => row.type === 'pointercancel').length, blocked ? 0 : 1);
      assert.deepEqual(rows.filter(row => row.type === 'touchstart').map(row => row.target), ['band0', blocked ? 'band0' : 'band1']);
      assert.equal(state.band0.y, record.mode === 'nested' ? 100 - (state.boxScrollTop ?? 0) : 0 - state.scrollY);
      for (const row of rows) {
        assert.equal(row.scrollY, row.root.scrollTop);
        assert.equal(row.scrollY, row.visual.pageTop);
        assert.equal(row.scrollY, row.pageYOffset);
        if (row.clientY !== null) {
          assert.ok(row.clientX !== null);
          assert.equal(row.pageY, row.clientY + row.scrollY, row.type);
          assert.equal(row.screenY, row.clientY + record.layout.viewport.screenOffsetY);
          assert.equal(row.screenX, row.clientX + record.layout.viewport.screenOffsetX);
        }
      }
      assert.equal(rows.some(row => row.type === 'scroll'), !blocked);
      assert.ok(rows.filter(row => row.type === 'scroll').every(row => row.trusted));
    } finally { await runtime.dispose(); }
    assert.equal(engine.active, 0);
  });
}

test('layout scroll APIs clamp, emit VisualViewport events and isolate each Realm', async () => {
  const plan = await planner.plan({ profile, page: page('root'), job });
  const engine = new JsdomEngine();
  const first = engine.open(plan, drivers);
  const second = engine.open(plan, drivers);
  try {
    assert.ok((await first.run(`globalThis.events=[];
      visualViewport.onscroll=e=>events.push(['handler',e.isTrusted,visualViewport.pageTop]);
      visualViewport.addEventListener('scroll',e=>events.push(['listener',e.isTrusted,visualViewport.pageTop]));
      scrollTo({top:1e6,behavior:'instant'});`)).ok);
    await delay(20);
    assert.deepEqual(await evaluate(first, 'events'), [['handler', true, 1651], ['listener', true, 1651]]);
    assert.equal(await evaluate(second, 'scrollY'), 0);
    assert.ok((await first.run('document.scrollingElement.scrollTop=-1;scrollBy(0,20)')).ok);
    assert.equal(await evaluate(first, 'scrollY'), 20);
    assert.equal(plan.boot.layout!.root.top, 0);
    assert.equal(await evaluate(first, 'document.elementFromPoint(-1,0)'), null);
    assert.ok(await evaluate(first, 'document.body.getBoundingClientRect() instanceof DOMRect'));
  } finally { await first.dispose(); await second.dispose(); }
  assert.equal(engine.active, 0);
});

test('layout invalidation is sticky, including mutations caught by page code, and releases the Runtime', async () => {
  const plan = await planner.plan({ profile, page: page('root'), job });
  const engine = new JsdomEngine();
  const runner = createNodeRuntime({ engine });
  for (const code of [
    'document.body.className="changed";try{document.body.getBoundingClientRect()}catch{};1',
    'document.body.firstChild.textContent="changed";1',
    'document.styleSheets[0].insertRule("body {height:1px}",0);1',
    'try{document.body.attachShadow({mode:"closed"})}catch{};1',
    'try{document.createElement("div").getBoundingClientRect()}catch{};1',
    'try{scrollTo({top:100,behavior:"smooth"})}catch{};1',
  ]) {
    const result = await runner.executePrepared(prepareExecution({ kind: 'run', code }, plan));
    assert.equal(result.ok, false, code);
    assert.match(JSON.stringify(result), /LAYOUT_INVALID/);
    assert.equal(engine.active, 0);
  }
  const clean = await runner.executePrepared(prepareExecution({ kind: 'run', code: 'scrollY', scriptUrl: 'https://layout.test/script.js' }, plan));
  assert.ok(clean.ok);
  assert.equal(clean.value, 0);
  assert.equal(engine.active, 0);
});

test('layout installation or cleanup failure cannot skip Driver cleanup or retain an active Runtime', async () => {
  const supplied = page('root');
  const plan = await planner.plan({ profile, page: supplied, job });
  const engine = new JsdomEngine();
  let closed = 0;
  const registry = { ...drivers, view: {
    open: (port: Port) => {
      const instance = drivers.view!.open(port);
      return { ...instance, close: () => { closed++; instance.close?.(); } };
    },
  } };
  const runtime = engine.open(plan, registry);
  assert.ok(runtime.run('Set.prototype.clear=()=>{throw new Error("layout-close")};0').ok);
  assert.throws(() => runtime.dispose(), /layout-close/);
  assert.equal(closed, 1);
  assert.equal(engine.active, 0);
  const { hash: _hash, ...body } = structuredClone(supplied);
  body.layout.viewport.width--;
  const mismatched = await planner.plan({ profile, page: seal(body), job });
  assert.throws(() => engine.open(mismatched, registry), /LAYOUT_INVALID: viewport/);
  assert.equal(closed, 2);
  assert.equal(engine.active, 0);
  const { hash: _quirksHash, ...quirks } = structuredClone(supplied);
  quirks.html = quirks.html.replace(/<!doctype html>/i, '');
  const quirksPlan = await planner.plan({ profile, page: seal(quirks), job });
  assert.throws(() => engine.open(quirksPlan, registry), /LAYOUT_INVALID: standards mode/);
  assert.equal(closed, 2);
  assert.equal(engine.active, 0);
});
