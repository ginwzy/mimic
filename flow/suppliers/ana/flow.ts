import { randomBytes, randomInt } from 'node:crypto';
import { DEFAULT_PROFILES_ROOT } from '../../../src/node/assets.js';
import { FpEnvProfiles } from '../../../src/profiles/fp-env.js';
import { captureBodies, listAndroidChromeProfiles, type CapturePool } from '../../capture.js';
import type { HeadersInit } from '../../client.js';
import { ANA_FLIGHT_SEARCH_URL, ANA_SELECT_URL, createAnaRequest } from './request.js';
import type { AnaCredentials, AnaVerifyResult } from './request.js';
import type { CaptureNetworkOptions } from '../../../src/network/types.js';

export interface AnaFlowOptions {
  capturePool?: CapturePool;
  proxy?: string;
  proxyHeaders?: HeadersInit;
  profile?: string;
  profilesRoot?: string;
  interactionSeed?: string;
  postCount?: number;
  networkMode?: 'offline' | 'closed-loop';
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
  if (bodies.length <= 5) return [...bodies];
  return [...bodies.slice(0, 2), ...bodies.slice(-1)];
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
  const networkMode = options.networkMode ?? 'offline';
  if (networkMode !== 'offline' && networkMode !== 'closed-loop') throw new TypeError('Invalid ANA networkMode');
  if (networkMode === 'closed-loop' && options.postCount !== undefined) {
    throw new TypeError('postCount is only supported in offline ANA mode');
  }
  const log = options.log ?? (() => {});
  const interactionSeed = options.interactionSeed ?? randomBytes(16).toString('hex');
  const profile = await resolveProfile(options.profile, options.profilesRoot);
  const { profile: browserProfile } = await new FpEnvProfiles(options.profilesRoot ?? DEFAULT_PROFILES_ROOT).load(profile);
  const request = await createAnaRequest({
    profile: browserProfile,
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
    ...(options.proxyHeaders === undefined ? {} : { proxyHeaders: options.proxyHeaders }),
    timeoutMs: 60_000,
    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    log,
    ...(networkMode === 'closed-loop' ? { closedLoop: true } : {}),
  });
  const networkFor = (url: string, posted: () => void): CaptureNetworkOptions => {
    const network = request.captureNetwork(url, ANA_SELECT_URL);
    return {
      ...network,
      request: async (outgoing) => {
        const response = await network.request(outgoing);
        if (outgoing.method === 'POST') posted();
        return response;
      },
    };
  };
  try {
    log(`ANA flow start profile=${profile}`);
    const shouldVerify = options.verify === true;
    let pageUrl = ANA_SELECT_URL;
    let html: string;

    if (shouldVerify) {
      // P1: seed www navigation + homepage-era sysdate before crossing to aswbe.
      await request.getWwwHome();
      log(`www-home cookies: ${cookieNames(request.cookies()).join(', ')}`);
      await request.getSysdate('?ctryCod=jp');
      // P1: flight-search document first; aswbe ABCK/BMS run against that page like the real SPA boot.
      html = await request.postFlightSearch();
      pageUrl = ANA_FLIGHT_SEARCH_URL;
      try {
        request.discoverScripts(html);
      } catch {
        log('flight-search HTML has no Akamai ABCK/BMS pair; falling back to system-error landing');
        html = await request.getLanding();
        pageUrl = ANA_SELECT_URL;
      }
    } else {
      html = await request.getLanding();
    }

    log(`landing cookies: ${cookieNames(request.cookies()).join(', ')}`);
    const scripts = request.discoverScripts(html);
    log(`ABCK=${scripts.abck}`);
    log(`BMS=${scripts.bms}`);

    const abckSource = await request.getScript(scripts.abck, pageUrl);
    let abckPostCount = 0;
    const abckCapture = await captureBodies({
      pageUrl,
      pageHtml: html,
      scriptUrl: scripts.abck,
      scriptSource: abckSource,
      cookies: networkMode === 'offline' ? splitCookies(request.cookies()) : [],
      ...(networkMode === 'closed-loop' ? { network: networkFor(scripts.abck, () => abckPostCount++) } : {}),
      profile,
      ...(options.profilesRoot === undefined ? {} : { profilesRoot: options.profilesRoot }),
      deadlineMs: 8_000,
      scriptTimeoutMs: 16_000,
      maxPosts: 14,
      mode: 'abck',
      interactionSeed,
    }, options.capturePool);
    if (abckCapture.bodies.length === 0) throw new Error('no _abck bodies captured');

    if (networkMode === 'offline') {
      const bodiesToPost = selectBodies(abckCapture.bodies, options.postCount);
      log(`ABCK captured=${abckCapture.bodies.length} posting=${bodiesToPost.length}`);
      for (const [index, body] of bodiesToPost.entries()) {
        await delay(250);
        log(`ABCK POST ${index + 1}/${bodiesToPost.length}`);
        await request.postAbck(scripts.abck, body, pageUrl);
        abckPostCount++;
      }
    } else {
      log(`ABCK captured=${abckCapture.bodies.length} completedPOSTs=${abckPostCount}`);
    }

    let bmsPosted = false;
    const bmsSource = await request.getScript(scripts.bms, pageUrl);
    const bmsCapture = await captureBodies({
      pageUrl,
      pageHtml: html,
      scriptUrl: scripts.bms,
      scriptSource: bmsSource,
      cookies: networkMode === 'offline' ? splitCookies(request.cookies()) : [],
      ...(networkMode === 'closed-loop' ? { network: networkFor(scripts.bms, () => { bmsPosted = true; }) } : {}),
      profile,
      ...(options.profilesRoot === undefined ? {} : { profilesRoot: options.profilesRoot }),
      deadlineMs: 7_000,
      scriptTimeoutMs: 16_000,
      maxPosts: 1,
      mode: 'bms',
    }, options.capturePool);
    if (networkMode === 'offline' && bmsCapture.bodies[0] !== undefined) {
      await request.postBms(scripts.bms, bmsCapture.bodies[0], pageUrl);
      bmsPosted = true;
    }

    let verifyResult: AnaVerifyResult | undefined;
    if (shouldVerify) {
      // P0: SPA bootstrap APIs that precede search in real traffic (placeholder bodies OK).
      await request.postInitialization();
      await request.getSysdate();
      await request.postChangeOfficeAndLang();
      verifyResult = await request.verify(options.verifyBody);
    }

    const cookies = request.cookies();
    const abckTilde0 = cookieValue(cookies, '_abck')?.includes('~0~') ?? false;
    return {
      profile,
      interactionSeed,
      cookies,
      abckBodyCount: abckCapture.bodies.length,
      abckPostCount,
      bmsPosted,
      abckTilde0,
      ...(verifyResult === undefined ? {} : { verify: verifyResult }),
    };
  } finally {
    await request.close();
  }
}

export { ANA_FLIGHT_SEARCH_URL, ANA_SELECT_URL, ANA_VERIFY_URL } from './request.js';
