import { randomBytes, randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_PROFILES_ROOT } from '../../../src/node/assets.js';
import { FpEnvProfiles } from '../../../src/profiles/fp-env.js';
import { captureBodies, listAndroidChromeProfiles, type CapturePool } from '../../capture.js';
import type { HeadersInit } from '../../client.js';
import { createJetstarRequest, isJetstarChallenge, type JetstarSearchOptions, type JetstarSearchResult, type JetstarSource } from './request.js';

export interface JetstarFlowOptions {
  capturePool?: CapturePool;
  proxy?: string;
  proxyHeaders?: HeadersInit;
  profile?: string;
  profilesRoot?: string;
  interactionSeed?: string;
  source?: JetstarSource;
  search?: boolean;
  searchOptions?: JetstarSearchOptions;
  log?: (message: string) => void;
}

export interface JetstarFlowResult {
  profile: string;
  interactionSeed: string;
  source: JetstarSource;
  sourceUrl: string;
  cookies: string;
  abckBodyCount: number;
  abckPostCount: number;
  bmsPosted: boolean;
  bmsPostCount: number;
  bmsTelemetryPosted: boolean;
  abckTilde0: boolean;
  challengeSolved: boolean;
  secCptState?: string;
  search?: JetstarSearchResult;
}

function splitCookies(header: string): string[] {
  return header.split(';').map(value => value.trim()).filter(value => value.includes('='));
}

// Port of akavm bms_init/env/08_runtime.js scheduleBehaviorTelemetry.
// BMS owns this touch/scroll recipe; the ABCK interaction adapter remains separate.
function withBmsBehavior(script: string): string {
  return `${script}\n;(() => {
    const jitter = limit => Math.floor((Math.random() * 2 - 1) * limit);
    const baseX = Math.round(innerWidth * (0.42 + Math.random() * 0.12));
    const startY = Math.round(innerHeight * (0.66 + Math.random() * 0.08));
    const target = document.body || document.documentElement;
    const touches = [
      [460, 'touchstart', 0], [492, 'touchmove', 20], [528, 'touchmove', 48],
      [572, 'touchmove', 82], [624, 'touchmove', 119], [686, 'touchmove', 151], [752, 'touchend', 151],
      [980, 'touchstart', 8], [1022, 'touchmove', 35], [1068, 'touchmove', 73],
      [1120, 'touchmove', 112], [1182, 'touchmove', 146], [1250, 'touchend', 146],
    ];
    for (const [at, type, offset] of touches) {
      const x = baseX + jitter(3);
      const y = startY - offset + jitter(4);
      setTimeout(() => {
        const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
        const active = type === 'touchend' ? [] : [touch];
        target.dispatchEvent(new TouchEvent(type, {
          bubbles: true, cancelable: true, touches: active, targetTouches: active, changedTouches: [touch],
        }));
      }, at + jitter(8));
    }
    const scale = 0.9 + Math.random() * 0.2;
    for (const [at, offset] of [
      [548, 18], [585, 39], [628, 67], [676, 99], [728, 128], [786, 149], [850, 164],
      [920, 174], [1040, 203], [1090, 237], [1145, 271], [1210, 298], [1290, 314],
    ]) {
      setTimeout(() => {
        const y = Math.max(0, Math.round(offset * scale + jitter(2)));
        for (const [key, value] of Object.entries({ scrollX: 0, pageXOffset: 0, scrollY: y, pageYOffset: y })) {
          Object.defineProperty(window, key, { value, writable: true, configurable: true, enumerable: true });
        }
        document.dispatchEvent(new Event('scroll', { bubbles: true }));
      }, at + jitter(8));
    }
    for (const at of [960, 1360]) {
      setTimeout(() => document.dispatchEvent(new Event('scrollend', { bubbles: true })), at + jitter(8));
    }
  })();`;
}

export async function runJetstarFlow(options: JetstarFlowOptions = {}): Promise<JetstarFlowResult> {
  const log = options.log ?? (() => {});
  const interactionSeed = options.interactionSeed ?? randomBytes(16).toString('hex');
  if (!interactionSeed.trim()) throw new TypeError('interactionSeed must not be empty');
  const profilesRoot = options.profilesRoot ?? DEFAULT_PROFILES_ROOT;
  const profiles = await listAndroidChromeProfiles(profilesRoot);
  if (profiles.length === 0) throw new Error('no Android Chrome fp-env records; configure profilesRoot and download data first');
  const profile = options.profile ?? profiles[randomInt(profiles.length)]!;
  if (!profiles.includes(profile)) throw new Error(`profile not found: ${profile}`);
  const { profile: browserProfile } = await new FpEnvProfiles(profilesRoot).load(profile);
  const choice = options.source === undefined ? randomInt(10) : undefined;
  const source = options.source ?? (choice! >= 9 ? 'home' : choice! > 4 ? 'mmb' : 'nuance');
  const request = await createJetstarRequest({
    profile: browserProfile, log,
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
    ...(options.proxyHeaders === undefined ? {} : { proxyHeaders: options.proxyHeaders }),
  });
  try {
    log(`Jetstar flow start profile=${profile} source=${source}`);
    const page = await request.getSource(source);
    const bmsUrl = request.discoverScript(page, 'bms');
    const bmsScript = await request.getScript(bmsUrl, page.url);
    const bmsCapture = await captureBodies({
      pageUrl: page.url, pageHtml: page.html, scriptUrl: bmsUrl, scriptSource: withBmsBehavior(bmsScript),
      cookies: splitCookies(request.cookies(page.url)), profile, profilesRoot,
      deadlineMs: 7_000, scriptTimeoutMs: 16_000, maxPosts: 2, mode: 'bms',
    }, options.capturePool);
    if (!bmsCapture.bodies.length) throw new Error('no Jetstar BMS bodies captured');
    for (const body of bmsCapture.bodies) await request.postBms(bmsUrl, body, page.url);
    const bmsTelemetryPosted = bmsCapture.bodies.length > 1;
    log(`BMS fingerprint posted; telemetry=${bmsTelemetryPosted ? 'posted' : 'not emitted'}`);

    const initialSearch = await request.search(options.searchOptions);
    let abckBodyCount = 0;
    let abckPostCount = 0;
    let secCptState: string | undefined;
    if (isJetstarChallenge(initialSearch.html)) {
      const captcha = await request.getCaptcha(initialSearch.url);
      const abckUrl = request.discoverScript(captcha, 'abck');
      const abckScript = await request.getScript(abckUrl, captcha.url);
      const abckCapture = await captureBodies({
        pageUrl: captcha.url, pageHtml: captcha.html, scriptUrl: abckUrl, scriptSource: abckScript,
        cookies: splitCookies(request.cookies(captcha.url)), profile, profilesRoot,
        deadlineMs: 8_000, scriptTimeoutMs: 16_000, maxPosts: 14, mode: 'abck', interactionSeed,
      }, options.capturePool);
      abckBodyCount = abckCapture.bodies.length;
      if (abckBodyCount < 3) throw new Error(`Jetstar requires three consecutive ABCK bodies; captured ${abckBodyCount}`);
      log(`ABCK captured=${abckBodyCount} posting=3`);
      for (const body of abckCapture.bodies.slice(0, 2)) {
        await delay(100);
        await request.postAbck(abckUrl, body, captcha.url);
        abckPostCount++;
      }
      await delay(100);
      await request.verifyPow(initialSearch.html, captcha.url);
      await delay(100);
      await request.postAbck(abckUrl, abckCapture.bodies[2]!, captcha.url);
      abckPostCount++;
      await delay(100);
      secCptState = await request.verifyChallenge(initialSearch.url);
    } else if (!initialSearch.success) {
      throw new Error(`Jetstar initial search HTTP ${initialSearch.status} (${initialSearch.class})`);
    }

    const search = options.search === true
      ? secCptState === undefined ? initialSearch : await request.search(options.searchOptions)
      : undefined;
    const cookies = request.cookies();
    const abck = splitCookies(cookies).find(cookie => cookie.startsWith('_abck='));
    return {
      profile, interactionSeed, source, sourceUrl: page.url, cookies,
      abckBodyCount, abckPostCount, bmsPosted: true, bmsPostCount: bmsCapture.bodies.length, bmsTelemetryPosted,
      abckTilde0: abck?.includes('~0~') ?? false, challengeSolved: secCptState === '3',
      ...(secCptState === undefined ? {} : { secCptState }),
      ...(search === undefined ? {} : { search }),
    };
  } finally {
    await request.close();
  }
}
