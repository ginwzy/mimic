import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Headers, Response, Session } from '@zionsssx/freq-js';
import { CapturePool, listAndroidChromeProfiles } from '../flow/capture.js';
import { runJetstarFlow } from '../flow/suppliers/jetstar/flow.js';
import { createJetstarRequest, JETSTAR_BOOKING_SITE, JETSTAR_CAPTCHA_URL } from '../flow/suppliers/jetstar/request.js';
import { FpEnvProfiles } from '../src/profiles/fp-env.js';

test('Jetstar runs BMS, redirected challenge, consecutive ABCK/PoW and final search with one session', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimic-jetstar-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.resolve('test/fixtures/fp-env'), root, { recursive: true });
  const file = path.join(root, '_fp-env/android_138/z__env_1.json');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  raw.navigator.userAgentData.HighEntropyValues.brands[2].brand = 'Google Chrome';
  await writeFile(file, JSON.stringify(raw));
  const [profile] = await listAndroidChromeProfiles(root);
  assert.ok(profile);
  const browser = (await new FpEnvProfiles(root).load(profile)).profile;
  const pool = new CapturePool();
  t.after(() => pool.close());

  const sourceUrl = 'https://booking.jetstar.com/mmb/?pid=subnav:mmb#/login?culture=en-au';
  const sourceHtml = '<base href="/assets/"><script src="app.js"></script><script src="sensor/bms?v=1&amp;t=2"></script>';
  const captchaHtml = '<form id="captcha-context"></form><script>var _appath="/sensor/abck";</script><script src="/sensor/abck"></script><script src="/sensor/adaptive" defer></script>';
  const challenge = { token: 'fixture-token', timestamp: 1760000000000, nonce: 'fixture-nonce', difficulty: 3, count: 3 };
  const challengeHtml = `<iframe id="sec-cpt" data-duration=1000 src="/captcha/adaptivecheck.html" challenge="${Buffer.from(JSON.stringify(challenge)).toString('base64')}"></iframe>`;
  const steps: string[] = [];
  const abckBodies: { index: number; url: string; cookie: string; form: boolean }[] = [];
  let searchCount = 0;
  let powCount = 0;
  let rejectFinal = false;
  let rejectBms = false;

  // Keep the flow, native cookie jar and real worker capture; substitute only remote responses.
  t.mock.method(Session.prototype, 'fetch', async function (
    this: Session, input: Parameters<Session['fetch']>[0], init: Parameters<Session['fetch']>[1],
  ) {
    const url = String(input);
    const target = new URL(url);
    const headers = new Headers(init?.headers);
    assert.equal(init?.disableDefaultHeaders, true);
    assert.equal(init?.redirect, 'manual');
    assert.equal(headers.get('user-agent'), browser.navigator.userAgent);
    const reply = (body: string, status = 200, values: [string, string][] = []) => new Response({
      status, headers: values, bodyHandle: null, bodyBytes: Buffer.from(body), contentLength: null, cookies: [], url: url.split('#')[0]!,
    }, url);
    if (init?.method === 'POST') {
      assert.equal(headers.get('sec-fetch-user'), null);
      assert.equal(headers.get('upgrade-insecure-requests'), null);
      assert.equal(headers.get('origin'), JETSTAR_BOOKING_SITE);
      assert.equal(headers.get('sec-fetch-mode'), 'cors');
      if (target.pathname === '/assets/sensor/bms') {
        steps.push('bms');
        assert.equal(target.search, '');
        assert.equal(headers.get('referer'), sourceUrl);
        assert.equal(headers.get('content-type'), 'application/json');
        const payload = JSON.parse(String(init.body));
        assert.equal(payload.s, steps.filter(step => step === 'bms').length === 1 ? 'f' : 't');
        if (payload.s === 't') {
          assert.equal(payload.starts, 2);
          assert.equal(payload.ends, 2);
          assert.ok(payload.moves >= 9);
          assert.ok(payload.scrolls >= 12);
          assert.ok(payload.y > 250);
        }
        if (rejectBms) return reply('', 403);
        return reply('');
      }
      assert.equal(headers.get('referer'), JETSTAR_CAPTCHA_URL);
      if (target.pathname === '/sensor/abck') {
        const body = JSON.parse(String(init.body));
        steps.push(`abck:${body.index}`);
        abckBodies.push(body);
        assert.equal(this.getCookies(url).sec_cpt, body.index === 2 ? 'renewed~2~state' : 'initial~1~state');
        return reply('{}');
      }
      assert.equal(target.pathname, '/_sec/verify');
      assert.equal(target.search, '?provider=adaptive');
      steps.push('pow');
      const payload = JSON.parse(String(init.body));
      assert.equal(payload.token, challenge.token);
      assert.equal(payload.answers.length, challenge.count);
      const sec = powCount === 0 ? 'initial' : 'renewed';
      for (const [index, answer] of payload.answers.entries()) {
        assert.match(answer, /^(0|0\.[0-9a-f]+)$/);
        const difficulty = challenge.difficulty + index;
        const digest = createHash('sha256').update(`${sec}${challenge.timestamp}${challenge.nonce}${difficulty}${answer}`).digest('hex');
        assert.equal(BigInt(`0x${digest}`) % BigInt(difficulty), 0n);
      }
      this.setCookie('sec_cpt', 'renewed~2~state', `${JETSTAR_BOOKING_SITE}/`);
      return reply(JSON.stringify(powCount++ === 0 ? challenge : { success: true }));
    }
    if (target.pathname === '/mmb/') {
      steps.push('source');
      this.setCookie('source', 'booking-only', url);
      return reply(sourceHtml);
    }
    if (target.pathname === '/assets/sensor/bms') {
      assert.equal(headers.get('sec-fetch-dest'), 'script');
      return reply(`
        navigator.sendBeacon('/bms', JSON.stringify({ s: 'f' }));
        let starts = 0, ends = 0, moves = 0, scrolls = 0;
        document.addEventListener('touchstart', () => starts++);
        document.addEventListener('touchend', () => ends++);
        document.addEventListener('touchmove', () => moves++);
        window.addEventListener('scroll', () => scrolls++);
        window.addEventListener('scrollend', () => {
          if (ends === 2) navigator.sendBeacon('/bms', JSON.stringify({ s: 't', starts, ends, moves, scrolls, y: scrollY }));
        });
      `);
    }
    if (target.pathname.endsWith('/search-flights')) {
      steps.push('search');
      assert.equal(target.searchParams.get('origin1'), 'MEL');
      assert.equal(target.searchParams.get('destination1'), 'CNS');
      assert.equal(target.searchParams.get('departuredate1'), '2026-10-01');
      this.setCookie('redirect', 'retained', url);
      return reply('', 302, [['location', '/au/en/booking/select-flights']]);
    }
    if (target.pathname.endsWith('/select-flights')) {
      assert.equal(this.getCookies(url).redirect, 'retained');
      if (searchCount++ === 0) {
        this.setCookie('sec_cpt', 'initial~1~state', `${JETSTAR_BOOKING_SITE}/`);
        return reply(challengeHtml);
      }
      assert.equal(this.getCookies(url).sec_cpt, 'renewed~3~state');
      // Even a large repeated challenge must not become a successful search.
      return reply(rejectFinal ? challengeHtml + ' '.repeat(15_000) : '<html>' + 'business '.repeat(2000) + '</html>');
    }
    if (target.pathname === '/captcha/adaptivecheck.html') {
      steps.push('captcha');
      assert.equal(headers.get('sec-fetch-dest'), 'iframe');
      assert.equal(headers.get('sec-fetch-user'), null);
      assert.equal(headers.get('referer'), `${JETSTAR_BOOKING_SITE}/au/en/booking/select-flights`);
      return reply(captchaHtml);
    }
    if (target.pathname === '/sensor/abck') {
      return reply(`for (let index = 0; index < 14; index++) navigator.sendBeacon('/sensor/abck', JSON.stringify({
        index, url: location.href, cookie: document.cookie, form: !!document.getElementById('captcha-context')
      }));`);
    }
    assert.equal(target.pathname, '/_sec/cp_challenge/verify');
    steps.push('verify');
    this.setCookie('sec_cpt', 'renewed~3~state', `${JETSTAR_BOOKING_SITE}/`);
    this.setCookie('_abck', 'fixture~0~state', `${JETSTAR_BOOKING_SITE}/`);
    return reply('{}');
  });

  for (const repeatedChallenge of [false, true]) {
    steps.length = 0;
    abckBodies.length = 0;
    searchCount = 0;
    powCount = 0;
    rejectFinal = repeatedChallenge;
    const result = await runJetstarFlow({
      profilesRoot: root, profile, capturePool: pool, source: 'mmb', interactionSeed: 'jetstar-fixture',
      search: true, searchOptions: { departureDate: '2026-10-01' },
    });
    assert.deepEqual(steps, ['source', 'bms', 'bms', 'search', 'captcha', 'abck:0', 'abck:1', 'pow', 'pow', 'abck:2', 'verify', 'search']);
    assert.deepEqual(abckBodies.map(body => body.index), [0, 1, 2]);
    for (const body of abckBodies) {
      assert.equal(body.url, JETSTAR_CAPTCHA_URL);
      assert.equal(body.form, true);
      assert.match(body.cookie, /sec_cpt=initial~1~state/);
    }
    assert.equal(result.interactionSeed, 'jetstar-fixture');
    assert.equal(result.sourceUrl, sourceUrl);
    assert.equal(result.abckBodyCount, 14);
    assert.equal(result.abckPostCount, 3);
    assert.equal(result.bmsPostCount, 2);
    assert.equal(result.bmsTelemetryPosted, true);
    assert.equal(result.challengeSolved, true);
    assert.equal(result.secCptState, '3');
    assert.equal(result.abckTilde0, true);
    assert.equal(result.search?.success, !repeatedChallenge);
    assert.equal(result.search?.class, repeatedChallenge ? 'sec_cpt' : 'large_html');
  }
  steps.length = 0;
  rejectBms = true;
  await assert.rejects(runJetstarFlow({ profilesRoot: root, profile, capturePool: pool, source: 'mmb' }), /Jetstar POST HTTP 403/);
  assert.deepEqual(steps, ['source', 'bms']);

  const request = await createJetstarRequest({ profile: browser });
  t.after(() => request.close());
  await assert.rejects(request.verifyPow(challengeHtml, JETSTAR_CAPTCHA_URL), /cookie missing/);
  await assert.rejects(request.search({ departureDate: '2026-02-30' }), /valid YYYY-MM-DD/);
  assert.throws(() => request.discoverScript({ html: '<script src="app.js"></script>', status: 200, url: sourceUrl }, 'abck'), /script not found/);
  assert.equal(request.discoverScript({
    html: '<script src="/sensor/abck"></script><script src="/sensor/adaptive" defer></script>', status: 200, url: JETSTAR_CAPTCHA_URL,
  }, 'abck'), `${JETSTAR_BOOKING_SITE}/sensor/abck`);
  assert.throws(() => request.discoverScript({
    html: '<script>var _appath="/missing/abck";</script><script src="/sensor/adaptive" defer></script>', status: 200, url: JETSTAR_CAPTCHA_URL,
  }, 'abck'), /_appath has no matching script/);
});
