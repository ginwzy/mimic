import { randomBytes, randomInt } from 'node:crypto';
import { parseEnvironment } from '../../../src/core/environment.js';
import type { ResolvedEnvironment } from '../../../src/core/types.js';
import { DEFAULT_PROFILES_ROOT } from '../../../src/node/assets.js';
import { FpEnvProfiles } from '../../../src/node/fp-env.js';
import { captureBodies, listAndroidChromeProfiles, type CapturePool } from '../../capture.js';
import type { HeadersInit } from '../../client.js';
import { ANA_SELECT_URL, createAnaRequest } from './request.js';
import type { AnaCredentials, AnaVerifyResult } from './request.js';

export interface AnaFlowOptions {
  capturePool?: CapturePool;
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
  environment: ResolvedEnvironment;
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
  return [...bodies.slice(0, 2), ...bodies.slice(-2)];
}

async function resolveProfile(explicit: string | undefined, profilesRoot: string | undefined): Promise<string> {
  const profiles = await listAndroidChromeProfiles(profilesRoot);
  if (explicit !== undefined) {
    if (!profiles.includes(explicit)) throw new Error(`profile not found: ${explicit}`);
    return explicit;
  }
  if (profiles.length === 0) throw new Error('no Android Chrome fp-env records; configure profilesRoot and download data first');
  return profiles[randomInt(profiles.length)] as string;
}

export async function runAnaFlow(options: AnaFlowOptions = {}): Promise<AnaFlowResult> {
  const environment = parseEnvironment({ regional: { random: true} });
  const log = options.log ?? (() => {});
  log(`regional environment=${JSON.stringify(environment)}`);
  const interactionSeed = options.interactionSeed ?? randomBytes(16).toString('hex');
  const profile = await resolveProfile(options.profile, options.profilesRoot);
  const { profile: browserProfile } = await new FpEnvProfiles(options.profilesRoot ?? DEFAULT_PROFILES_ROOT).load(profile);
  const request = await createAnaRequest({
    profile: browserProfile,
    environment,
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
      environment,
      ...(options.profilesRoot === undefined ? {} : { profilesRoot: options.profilesRoot }),
      deadlineMs: 8_000,
      scriptTimeoutMs: 16_000,
      maxPosts: 14,
      mode: 'abck',
      interactionSeed,
    }, options.capturePool);
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
      environment,
      ...(options.profilesRoot === undefined ? {} : { profilesRoot: options.profilesRoot }),
      deadlineMs: 7_000,
      scriptTimeoutMs: 16_000,
      maxPosts: 1,
      mode: 'bms',
    }, options.capturePool);
    if (bmsCapture.bodies[0] !== undefined) {
      await request.postBms(scripts.bms, bmsCapture.bodies[0]);
      bmsPosted = true;
    }

    if (options.verify === true) await request.postFlightSearch();
    const cookies = request.cookies();
    const abckTilde0 = cookieValue(cookies, '_abck')?.includes('~0~') ?? false;
    const verify = options.verify === true ? await request.verify(options.verifyBody) : undefined;
    return {
      profile,
      environment,
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

export { ANA_FLIGHT_SEARCH_URL, ANA_SELECT_URL, ANA_VERIFY_URL } from './request.js';
