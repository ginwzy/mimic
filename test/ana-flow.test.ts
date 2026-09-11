import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AnaFlowOptions, runAnaFlow as RunAnaFlow } from '../flow/suppliers/ana/flow.js';

interface Fixture {
  bodies: readonly string[];
  posted: string[];
  bmsPosts: string[];
  closed: number;
  live: string[];
  steps: string[];
  bmsBodies: readonly string[];
  bmsStatus: number;
}

test('ANA flow posts each selected capture position once in order', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimic-ana-flow-'));
  try {
    const flowRoot = path.join(root, 'flow');
    const supplier = path.join(flowRoot, 'suppliers', 'ana');
    await mkdir(supplier, { recursive: true });
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    // Execute the compiled production flow unchanged, with local input/output adapters.
    await copyFile(new URL('../flow/suppliers/ana/flow.js', import.meta.url), path.join(supplier, 'flow.js'));
    for (const dir of ['node', 'profiles']) await mkdir(path.join(root, 'src', dir), { recursive: true });
    await writeFile(path.join(root, 'src/node/assets.js'), 'export const DEFAULT_PROFILES_ROOT = "unused";');
    await writeFile(path.join(root, 'src/profiles/fp-env.js'), 'export class FpEnvProfiles { async load() { return { profile: {} }; } }');
    await writeFile(path.join(flowRoot, 'capture.js'), `
      export const fixture = { bodies: [], posted: [], bmsPosts: [], closed: 0, live: [], steps: [], bmsBodies: ['bms-body'], bmsStatus: 200 };
      export async function listAndroidChromeProfiles() { return ['fixture-profile']; }
      export async function captureBodies(options) {
        fixture.steps.push('capture:' + options.mode);
        const pageUrl = options.mode === 'bms' ? 'https://www.fixture.invalid/' : 'https://fixture.invalid/search';
        if (options.pageUrl !== pageUrl) throw new Error('wrong capture page: ' + options.pageUrl);
        if (new URL(options.scriptUrl).origin !== new URL(pageUrl).origin) throw new Error('wrong script origin');
        if (options.mode === 'bms' && options.interactionSeed !== undefined) throw new Error('BMS must not use interaction');
        const bodies = options.mode === 'abck' ? fixture.bodies : fixture.bmsBodies;
        if (options.network) {
          if (options.cookies.length) throw new Error('flattened cookies in live capture');
          for (const body of bodies) {
            await options.network.request(new Request(options.scriptUrl, { method: 'POST', body }));
          }
        } else if (options.cookies[0] !== 'host=' + new URL(pageUrl).host) {
          throw new Error('wrong cookie scope');
        }
        return { bodies, posts: [] };
      }
    `);
    await writeFile(path.join(supplier, 'request.js'), `
      import { fixture } from '../../capture.js';
      export const ANA_SITE = 'https://www.fixture.invalid';
      export const ANA_SELECT_URL = 'https://fixture.invalid/page';
      export const ANA_FLIGHT_SEARCH_URL = 'https://fixture.invalid/search';
      export const ANA_VERIFY_URL = 'https://fixture.invalid/verify';
      export async function createAnaRequest() {
        return {
          getWwwHome: async () => { fixture.steps.push('home'); return '<html><body></body></html>'; },
          postFlightSearch: async () => { fixture.steps.push('flight-search'); return '<html><body></body></html>'; },
          getLanding: async () => '<html><body></body></html>',
          discoverScripts: (html, pageUrl) => ({ abck: new URL('/abck-script', pageUrl).href, bms: new URL('/bms-script', pageUrl).href }),
          captureNetwork: (url, pageUrl) => {
            if (new URL(url).origin !== new URL(pageUrl).origin) throw new Error('wrong live page origin');
            return { allowedUrls: [url], request: async request => {
              fixture.live.push(await request.text());
              const bms = request.url.includes('bms-script');
              fixture.steps.push(bms ? 'post:bms' : 'post:abck');
              return new Response('accepted', { status: bms ? fixture.bmsStatus : 200 });
            } };
          },
          getScript: async url => { fixture.steps.push('script:' + url); return 'fixture-script'; },
          cookies: url => 'host=' + new URL(url ?? ANA_SITE).host + '; _abck=fixture~0~',
          postAbck: async (url, body) => { fixture.steps.push('post:abck'); fixture.posted.push(body); },
          postBms: async (url, body, referer) => {
            if (new URL(url).origin !== ANA_SITE || referer !== ANA_SITE + '/') throw new Error('wrong homepage BMS target');
            fixture.steps.push('post:bms'); fixture.bmsPosts.push(body);
            if (fixture.bmsStatus !== 200) throw new Error('BMS POST HTTP ' + fixture.bmsStatus);
          },
          getSysdate: async query => { fixture.steps.push('sysdate:' + (query ?? '')); },
          postInitialization: async () => { fixture.steps.push('initialization'); },
          postChangeOfficeAndLang: async () => { fixture.steps.push('change-office'); },
          verify: async () => { fixture.steps.push('verify'); return { status: 200, body: '{}', class: 'ok_2xx', success: true }; },
          close: async () => { fixture.closed++; },
        };
      }
    `);
    const { fixture } = await import(pathToFileURL(path.join(flowRoot, 'capture.js')).href) as { fixture: Fixture };
    const { runAnaFlow } = await import(pathToFileURL(path.join(supplier, 'flow.js')).href) as { runAnaFlow: typeof RunAnaFlow };
    const cases: { name: string; bodies: readonly string[]; expected: readonly string[]; postCount?: number }[] = [];
    for (const count of [1, 2, 3, 4, 5, 6, 11]) {
      const bodies = Array.from({ length: count }, (_, index) => `body-${index + 1}`);
      cases.push({
        name: `default selection from ${count} captures`,
        bodies,
        expected: bodies.filter((_, index) => index < 2 || index >= count - 3),
      });
    }
    cases.push({
      name: 'identical bodies from distinct captures remain distinct requests',
      bodies: ['same', 'same', 'same'], expected: ['same', 'same', 'same'],
    });
    for (const [postCount, expected] of [
      [-1, []], [0, []], [2, ['a', 'b']], [20, ['a', 'b', 'c', 'd']],
    ] as const) {
      cases.push({
        name: `explicit postCount=${postCount} retains prefix selection`,
        bodies: ['a', 'b', 'c', 'd'], postCount,
        expected,
      });
    }
    for (const entry of cases) {
      await t.test(entry.name, async () => {
        fixture.bodies = Object.freeze([...entry.bodies]);
        fixture.posted = [];
        fixture.bmsPosts = [];
        fixture.closed = 0;
        const options: AnaFlowOptions = { profile: 'fixture-profile', interactionSeed: 'fixture-seed' };
        if (entry.postCount !== undefined) options.postCount = entry.postCount;
        const result = await runAnaFlow(options);
        assert.deepEqual(fixture.posted, entry.expected);
        assert.deepEqual(fixture.bodies, entry.bodies);
        assert.equal(result.abckBodyCount, entry.bodies.length);
        assert.equal(result.abckPostCount, entry.expected.length);
        assert.deepEqual(fixture.bmsPosts, ['bms-body']);
        assert.equal(result.bmsPosted, true);
        assert.equal(fixture.closed, 1);
      });
    }
    await t.test('empty capture still rejects and closes the request', async () => {
      fixture.bodies = [];
      fixture.posted = [];
      fixture.bmsPosts = [];
      fixture.closed = 0;
      await assert.rejects(runAnaFlow({ profile: 'fixture-profile', interactionSeed: 'fixture-seed' }), /no _abck bodies captured/);
      assert.deepEqual(fixture.posted, []);
      assert.deepEqual(fixture.bmsPosts, ['bms-body']);
      assert.equal(fixture.closed, 1);
    });
    await t.test('closed-loop posts every request during capture without replaying it', async () => {
      fixture.bodies = ['a', 'b', 'c', 'd', 'e', 'f'];
      fixture.posted = [];
      fixture.bmsPosts = [];
      fixture.closed = 0;
      fixture.live = [];
      const result = await runAnaFlow({ profile: 'fixture-profile', networkMode: 'closed-loop' });
      assert.deepEqual(fixture.live, ['bms-body', ...fixture.bodies]);
      assert.deepEqual(fixture.posted, []);
      assert.deepEqual(fixture.bmsPosts, []);
      assert.equal(result.abckPostCount, 6);
      assert.equal(result.bmsPosted, true);
      assert.equal(fixture.closed, 1);
    });
    await t.test('closed-loop rejects offline post selection before creating a request', async () => {
      fixture.closed = 0;
      await assert.rejects(runAnaFlow({ networkMode: 'closed-loop', postCount: 2 }), /postCount is only supported in offline/);
      assert.equal(fixture.closed, 0);
    });
    for (const networkMode of ['offline', 'closed-loop'] as const) {
      await t.test(`${networkMode}: homepage BMS precedes flight-search and only ABCK follows`, async () => {
        fixture.bodies = ['abck-body'];
        fixture.steps = [];
        fixture.closed = 0;
        const result = await runAnaFlow({ profile: 'fixture-profile', networkMode, verify: true });
        assert.deepEqual(fixture.steps, [
          'home', 'script:https://www.fixture.invalid/bms-script', 'capture:bms', 'post:bms',
          'sysdate:?ctryCod=jp', 'flight-search',
          'script:https://fixture.invalid/abck-script', 'capture:abck', 'post:abck',
          'initialization', 'sysdate:', 'change-office', 'verify',
        ]);
        assert.equal(result.bmsPosted, true);
        assert.equal(result.verify?.status, 200);
        assert.equal(fixture.closed, 1);
      });
      for (const failure of ['empty', 'rejected'] as const) {
        await t.test(`${networkMode}: ${failure} homepage BMS stops before flight-search`, async () => {
          fixture.steps = [];
          fixture.closed = 0;
          fixture.bmsBodies = failure === 'empty' ? [] : ['bms-body'];
          fixture.bmsStatus = failure === 'rejected' ? 403 : 200;
          try {
            await assert.rejects(runAnaFlow({ profile: 'fixture-profile', networkMode, verify: true }), /BMS/);
            assert.equal(fixture.steps.includes('flight-search'), false);
            assert.equal(fixture.steps.includes('capture:abck'), false);
            assert.equal(fixture.closed, 1);
          } finally {
            fixture.bmsBodies = ['bms-body'];
            fixture.bmsStatus = 200;
          }
        });
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
