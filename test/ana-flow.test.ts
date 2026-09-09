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
      export const fixture = { bodies: [], posted: [], bmsPosts: [], closed: 0, live: [] };
      export async function listAndroidChromeProfiles() { return ['fixture-profile']; }
      export async function captureBodies(options) {
        if (options.network) {
          if (options.cookies.length) throw new Error('flattened cookies in live capture');
          for (const body of options.mode === 'abck' ? fixture.bodies : ['bms-body']) {
            await options.network.request(new Request(options.scriptUrl, { method: 'POST', body }));
          }
        }
        return { bodies: options.mode === 'abck' ? fixture.bodies : ['bms-body'], posts: [] };
      }
    `);
    await writeFile(path.join(supplier, 'request.js'), `
      import { fixture } from '../../capture.js';
      export const ANA_SELECT_URL = 'https://fixture.invalid/page';
      export const ANA_FLIGHT_SEARCH_URL = 'https://fixture.invalid/search';
      export const ANA_VERIFY_URL = 'https://fixture.invalid/verify';
      export async function createAnaRequest() {
        return {
          getLanding: async () => '<html><body></body></html>',
          discoverScripts: () => ({ abck: 'https://fixture.invalid/abck-script', bms: 'https://fixture.invalid/bms-script' }),
          captureNetwork: url => ({ allowedUrls: [url], request: async request => {
            fixture.live.push(await request.text());
            return new Response('accepted');
          } }),
          getScript: async () => 'fixture-script',
          cookies: () => '_abck=fixture~0~',
          postAbck: async (url, body) => { fixture.posted.push(body); },
          postBms: async (url, body) => { fixture.bmsPosts.push(body); },
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
      assert.deepEqual(fixture.bmsPosts, []);
      assert.equal(fixture.closed, 1);
    });
    await t.test('closed-loop posts every request during capture without replaying it', async () => {
      fixture.bodies = ['a', 'b', 'c', 'd', 'e', 'f'];
      fixture.posted = [];
      fixture.bmsPosts = [];
      fixture.closed = 0;
      fixture.live = [];
      const result = await runAnaFlow({ profile: 'fixture-profile', networkMode: 'closed-loop' });
      assert.deepEqual(fixture.live, [...fixture.bodies, 'bms-body']);
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
