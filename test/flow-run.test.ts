import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

interface Outcome {
  status?: number;
  success?: boolean;
  class?: string;
  error?: string;
  missing?: boolean;
  delay?: number;
}

interface FlowEvent {
  event: 'start' | 'end';
  index: number;
  profile: string;
  running: number;
}

test('flow CLI batch statistics and Profile allocation', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimic-flow-run-'));
  try {
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await copyFile(new URL('../flow/run.js', import.meta.url), path.join(root, 'run.js'));
    await writeFile(path.join(root, 'proxy.js'), `
      export const createLumiProxy = () => { throw new Error('unexpected proxy'); };
      export const createLumiRelayProxy = createLumiProxy;
    `);
    await writeFile(path.join(root, 'capture.js'), `
      export class CapturePool { async close() {} }
      export async function listAndroidChromeProfiles() {
        console.error('FIXTURE_PROFILE_LIST');
        return Object.freeze(JSON.parse(process.env.FLOW_PROFILES));
      }
    `);
    // Keep the CLI and concurrent batch loop unchanged; supply local flow outcomes without network access.
    await writeFile(path.join(root, 'outcomes.js'), `
      const outcomes = JSON.parse(process.env.FLOW_OUTCOMES);
      let next = 0;
      let running = 0;
      const active = new Set();
      export async function run(options, key) {
        const index = next++;
        const outcome = outcomes[index];
        const profile = options.profile ?? 'fixture-profile';
        if (process.env.FLOW_UNIQUE === 'true' && active.has(profile)) throw new Error('overlapping Profile: ' + profile);
        active.add(profile);
        running++;
        console.error('FIXTURE_FLOW ' + JSON.stringify({ event: 'start', index, profile, running }));
        try {
          await new Promise(resolve => setTimeout(resolve, outcome.delay ?? 0));
          if (outcome.error !== undefined) throw new Error(outcome.error);
          return { profile, [key]: outcome.missing ? undefined : outcome };
        } finally {
          active.delete(profile);
          running--;
          console.error('FIXTURE_FLOW ' + JSON.stringify({ event: 'end', index, profile, running }));
        }
      }
    `);
    for (const [supplier, name, key] of [['ana', 'runAnaFlow', 'verify'], ['cebu', 'runCebuFlow', 'search']] as const) {
      const directory = path.join(root, 'suppliers', supplier);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'flow.js'), `
        import { run } from '../../outcomes.js';
        export const ${name} = options => run(options, '${key}');
      `);
    }
    const run = (supplier: string, outcomes: Outcome[], config: {
      batch?: boolean;
      profiles?: string[];
      concurrency?: number;
      random?: boolean;
      exitCode?: number;
    } = {}) => {
      const args = [path.join(root, 'run.js'), supplier, 'none'];
      if (!config.random) args.push('--profile', 'fixture-profile');
      if (config.batch !== false) args.push('--total', String(outcomes.length), '--concurrency', String(config.concurrency ?? 3));
      const result = spawnSync(process.execPath, args, {
        encoding: 'utf8', timeout: 10_000,
        env: {
          ...process.env,
          FLOW_OUTCOMES: JSON.stringify(outcomes),
          FLOW_PROFILES: JSON.stringify(config.profiles ?? ['fixture-profile']),
          FLOW_UNIQUE: String(config.random ?? false),
        },
      });
      assert.equal(result.status, config.exitCode ?? 0, result.error?.message ?? result.stderr);
      const events = result.stderr.split('\n').filter(line => line.startsWith('FIXTURE_FLOW '))
        .map(line => JSON.parse(line.slice('FIXTURE_FLOW '.length)) as FlowEvent);
      return {
        summary: result.stdout ? JSON.parse(result.stdout) : undefined,
        stderr: result.stderr,
        events,
        starts: events.filter(event => event.event === 'start'),
      };
    };

    await t.test('ANA counts returned failures, normalized exceptions and missing results once each', () => {
      const { summary, stderr } = run('ana', [
        { status: 200, success: true, class: 'ok_2xx', delay: 15 },
        { status: 401, success: true, class: 'verify_401' },
        { status: 403, success: false, class: 'edge_403' },
        { status: 403, success: false, class: 'edge_403', delay: 10 },
        { status: 503, success: false, class: 'soft_blocked_processing' },
        { error: 'request\n timed out' },
        { error: 'request timed out' },
        { missing: true },
      ]);
      assert.equal(summary.total, 8);
      assert.equal(summary.successful, 2);
      assert.equal(summary.failed, 6);
      assert.equal(summary.successRate, '25.00%');
      assert.deepEqual(summary.errorDistribution, [
        { error: 'Error: request timed out', count: 2, percentage: '33.33%' },
        { error: 'HTTP 403 (edge_403)', count: 2, percentage: '33.33%' },
        { error: 'HTTP 503 (soft_blocked_processing)', count: 1, percentage: '16.67%' },
        { error: 'unsuccessful result', count: 1, percentage: '16.67%' },
      ]);
      assert.match(stderr, /error=HTTP 403 \(edge_403\)/);
      assert.doesNotMatch(stderr, /error=.*401/);
    });

    await t.test('Cebu groups failed HTTP statuses and excludes successful 401 responses', () => {
      const { summary } = run('cebu', [
        { status: 401, success: true },
        { status: 403, success: false, delay: 10 },
        { status: 503, success: false },
        { status: 403, success: false },
      ]);
      assert.equal(summary.successful, 1);
      assert.equal(summary.failed, 3);
      assert.deepEqual(summary.errorDistribution, [
        { error: 'HTTP 403', count: 2, percentage: '66.67%' },
        { error: 'HTTP 503', count: 1, percentage: '33.33%' },
      ]);
    });

    await t.test('an all-success batch has an empty distribution', () => {
      const { summary } = run('ana', [
        { status: 200, success: true, class: 'ok_2xx' },
        { status: 401, success: true, class: 'verify_401' },
      ]);
      assert.equal(summary.failed, 0);
      assert.equal(summary.successRate, '100.00%');
      assert.deepEqual(summary.errorDistribution, []);
    });

    await t.test('single-run output remains unchanged', () => {
      const { summary } = run('ana', [{ status: 403, success: false, class: 'edge_403' }], { batch: false });
      assert.equal(summary.profile, 'fixture-profile');
      assert.deepEqual(summary.verify, { status: 403, success: false, class: 'edge_403' });
      assert.equal(summary.errorDistribution, undefined);
    });

    for (const supplier of ['ana', 'cebu']) {
      await t.test(`${supplier} allocates distinct random Profiles within a round`, () => {
        const profiles = ['p0', 'p1', 'p2', 'p3', 'p4'];
        const outcomes = Array.from({ length: 4 }, () => ({ status: 200, success: true, delay: 10 }));
        const { summary, starts, stderr } = run(supplier, outcomes, { random: true, profiles });
        assert.equal(summary.failed, 0);
        assert.equal(starts.length, 4);
        assert.equal(new Set(starts.map(event => event.profile)).size, 4);
        assert.ok(starts.every(event => profiles.includes(event.profile)));
        assert.equal(Math.max(...starts.map(event => event.running)), 3);
        assert.equal(stderr.split('FIXTURE_PROFILE_LIST').length - 1, 1);
      });
    }

    await t.test('new rounds wait for slow and failed tasks before reusing Profiles', () => {
      const profiles = ['p0', 'p1', 'p2', 'p3'];
      const outcomes = Array.from({ length: 11 }, (_, index) => ({
        status: 200, success: true, delay: index === 0 ? 45 : 2,
        ...([1, 7].includes(index) ? { error: 'fixture transient error' } : {}),
      }));
      const { summary, events, starts } = run('ana', outcomes, { random: true, profiles });
      assert.equal(summary.failed, 2);
      assert.deepEqual(summary.errorDistribution, [
        { error: 'Error: fixture transient error', count: 2, percentage: '100.00%' },
      ]);
      assert.equal(starts.length, 11);
      assert.equal(events.filter(event => event.event === 'end').length, 11);
      for (let index = 0; index < starts.length; index += profiles.length) {
        const round = starts.slice(index, index + profiles.length);
        assert.equal(round[0]!.running, 1);
        assert.equal(new Set(round.map(event => event.profile)).size, round.length);
      }
    });

    await t.test('a pool smaller than requested concurrency limits active tasks, including a one-Profile pool', () => {
      for (const profiles of [['p0'], ['p0', 'p1']]) {
        const outcomes = Array.from({ length: 5 }, () => ({ status: 200, success: true, delay: 5 }));
        const { summary, starts } = run('ana', outcomes, { random: true, profiles, concurrency: 8 });
        assert.equal(summary.failed, 0);
        assert.equal(starts.length, 5);
        assert.equal(Math.max(...starts.map(event => event.running)), profiles.length);
        assert.ok(starts.every(event => profiles.includes(event.profile)));
      }
    });

    await t.test('an explicit Profile retains fixed concurrent selection without listing the pool', () => {
      const outcomes = Array.from({ length: 4 }, () => ({ status: 200, success: true, delay: 5 }));
      const { summary, starts, stderr } = run('ana', outcomes);
      assert.equal(summary.failed, 0);
      assert.equal(starts.length, 4);
      assert.ok(starts.every(event => event.profile === 'fixture-profile'));
      assert.equal(Math.max(...starts.map(event => event.running)), 3);
      assert.doesNotMatch(stderr, /FIXTURE_PROFILE_LIST/);
    });

    await t.test('an empty random pool fails before dispatching any tasks', () => {
      const { summary, events, stderr } = run('ana', [{ status: 200, success: true }], {
        random: true, profiles: [], exitCode: 1,
      });
      assert.equal(summary, undefined);
      assert.deepEqual(events, []);
      assert.match(stderr, /no Android Chrome fp-env records/);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
