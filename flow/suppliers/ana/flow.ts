import { randomBytes, randomInt } from 'node:crypto';
import { captureBodies, listAndroidChromeProfiles } from '../../capture.js';
import type { HeadersInit } from '../../client.js';
import { ANA_SELECT_URL, createAnaRequest } from './request.js';
import type { AnaCredentials, AnaVerifyResult } from './request.js';

const DEFAULT_PROFILE = 'android-chrome/2201116sg-v145-10025';

export interface AnaFlowOptions {
  proxy?: string;
  proxyHeaders?: HeadersInit;
  profile?: string;
  profilesRoot?: string;
  interactionSeed?: string;
  postCount?: number;
  verify?: boolean;
  verifyBody?: string;
  credentials?: AnaCredentials;
  log?: (message: string) => void;
}

export interface AnaFlowResult {
  profile: string;
  interactionSeed: string;
  cookies: string;
  abckBodyCount: number;
  abckPostCount: number;
  bmsPosted: boolean;
  abckTilde0: boolean;
  verify?: AnaVerifyResult;
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

function splitCookies(cookieHeader: string): string[] {
  return cookieHeader.split(';').map((cookie) => cookie.trim()).filter((cookie) => cookie.includes('='));
}

function cookieValue(cookieHeader: string, name: string): string | undefined {
  for (const cookie of splitCookies(cookieHeader)) {
    const separator = cookie.indexOf('=');
    if (cookie.slice(0, separator) === name) return cookie.slice(separator + 1);
  }
  return undefined;
}

function cookieNames(cookieHeader: string): string[] {
  return splitCookies(cookieHeader).map((cookie) => cookie.slice(0, cookie.indexOf('=')).trim());
}

function selectBodies(bodies: readonly string[], postCount: number | undefined): string[] {
  if (postCount !== undefined) return bodies.slice(0, Math.max(0, postCount));
  if (bodies.length <= 2) return [...bodies];
  return [...bodies.slice(0, 2), ...bodies.slice(-1)];
}

async function resolveProfile(explicit: string | undefined, profilesRoot: string | undefined): Promise<string> {
  const profiles = await listAndroidChromeProfiles(profilesRoot);
  if (explicit !== undefined) {
    if (!profiles.includes(explicit)) throw new Error(`profile not found: ${explicit}`);
    return explicit;
  }
  return profiles.length === 0 ? DEFAULT_PROFILE : profiles[randomInt(profiles.length)] as string;
}

export async function runAnaFlow(options: AnaFlowOptions = {}): Promise<AnaFlowResult> {
  const log = options.log ?? (() => {});
  const interactionSeed = options.interactionSeed ?? randomBytes(16).toString('hex');
  const profile = await resolveProfile(options.profile, options.profilesRoot);
  const request = await createAnaRequest({
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
    ...(options.proxyHeaders === undefined ? {} : { proxyHeaders: options.proxyHeaders }),
    timeoutMs: 60_000,
    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    log,
  });
  try {
    log(`ANA flow start profile=${profile}`);
    const html = await request.getLanding();
    log(`landing cookies: ${cookieNames(request.cookies()).join(', ')}`);
    const scripts = request.discoverScripts(html);
    log(`ABCK=${scripts.abck}`);
    log(`BMS=${scripts.bms}`);

    const abckSource = await request.getScript(scripts.abck);
    const abckCapture = await captureBodies({
      pageUrl: ANA_SELECT_URL,
      pageHtml: html,
      scriptUrl: scripts.abck,
      scriptSource: abckSource,
      cookies: splitCookies(request.cookies()),
      profile,
      ...(options.profilesRoot === undefined ? {} : { profilesRoot: options.profilesRoot }),
      deadlineMs: 8_000,
      scriptTimeoutMs: 16_000,
      maxPosts: 14,
      mode: 'abck',
      interactionSeed,
    });
    if (abckCapture.bodies.length === 0) throw new Error('no _abck bodies captured');

    const bodiesToPost = selectBodies(abckCapture.bodies, options.postCount);
    log(`ABCK captured=${abckCapture.bodies.length} posting=${bodiesToPost.length}`);
    for (const [index, body] of bodiesToPost.entries()) {
      await delay(250);
      log(`ABCK POST ${index + 1}/${bodiesToPost.length}`);
      await request.postAbck(scripts.abck, body);
    }

    let bmsPosted = false;
    const bmsSource = await request.getScript(scripts.bms);
    const bmsCapture = await captureBodies({
      pageUrl: ANA_SELECT_URL,
      pageHtml: html,
      scriptUrl: scripts.bms,
      scriptSource: bmsSource,
      cookies: splitCookies(request.cookies()),
      profile,
      ...(options.profilesRoot === undefined ? {} : { profilesRoot: options.profilesRoot }),
      deadlineMs: 7_000,
      scriptTimeoutMs: 16_000,
      maxPosts: 1,
      mode: 'bms',
    });
    if (bmsCapture.bodies[0] !== undefined) {
      await request.postBms(scripts.bms, bmsCapture.bodies[0]);
      bmsPosted = true;
    }

    const cookies = request.cookies();
    const abckTilde0 = cookieValue(cookies, '_abck')?.includes('~0~') ?? false;
    const verify = options.verify === true ? await request.verify(options.verifyBody) : undefined;
    return {
      profile,
      interactionSeed,
      cookies,
      abckBodyCount: abckCapture.bodies.length,
      abckPostCount: bodiesToPost.length,
      bmsPosted,
      abckTilde0,
      ...(verify === undefined ? {} : { verify }),
    };
  } finally {
    await request.close();
  }
}

export { ANA_SELECT_URL, ANA_VERIFY_URL } from './request.js';
