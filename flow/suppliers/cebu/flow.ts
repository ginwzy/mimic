import { randomBytes, randomInt } from 'node:crypto';
import { captureBodies, listAndroidChromeProfiles } from '../../capture.js';
import type { HeadersInit } from '../../client.js';
import { CEBU_SELECT_URL, createCebuRequest } from './request.js';
import type { CebuCredentials, CebuSearchResult } from './request.js';

const DEFAULT_PROFILE = 'android-chrome/2201116sg-v145-10025';

export type CebuAbckPolicy = 'all' | 'edges';

export interface CebuFlowOptions {
  proxy?: string;
  proxyHeaders?: HeadersInit;
  profile?: string;
  profilesRoot?: string;
  interactionSeed?: string;
  postCount?: number;
  abckPolicy?: CebuAbckPolicy;
  search?: boolean;
  searchBody?: string;
  credentials?: CebuCredentials;
  log?: (message: string) => void;
}

export interface CebuFlowResult {
  profile: string;
  interactionSeed: string;
  cookies: string;
  abckBodyCount: number;
  abckPostCount: number;
  bmsPosted: boolean;
  abckTilde0: boolean;
  search?: CebuSearchResult;
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

function selectBodies(
  bodies: readonly string[],
  postCount: number | undefined,
  policy: CebuAbckPolicy,
): string[] {
  if (postCount !== undefined) return [...bodies.slice(0, Math.max(0, postCount))];
  if (policy === 'all' || bodies.length <= 2) return [...bodies];
  return [bodies[0] as string, bodies[1] as string, bodies[bodies.length - 1] as string];
}

async function resolveProfile(explicit: string | undefined, profilesRoot: string | undefined): Promise<string> {
  const profiles = await listAndroidChromeProfiles(profilesRoot);
  if (explicit !== undefined) {
    if (!profiles.includes(explicit)) throw new Error(`profile not found: ${explicit}`);
    return explicit;
  }
  return profiles.length === 0 ? DEFAULT_PROFILE : profiles[randomInt(profiles.length)] as string;
}

export async function runCebuFlow(options: CebuFlowOptions = {}): Promise<CebuFlowResult> {
  const log = options.log ?? (() => {});
  const interactionSeed = options.interactionSeed ?? randomBytes(16).toString('hex');
  const profile = await resolveProfile(options.profile, options.profilesRoot);
  const request = await createCebuRequest({
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
    ...(options.proxyHeaders === undefined ? {} : { proxyHeaders: options.proxyHeaders }),
    timeoutMs: 60_000,
    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    log,
  });
  try {
    log(`Cebu flow start profile=${profile}`);
    const html = await request.getLanding();
    log(`landing cookies: ${cookieNames(request.cookies()).join(', ')}`);
    const scripts = request.discoverScripts(html);
    log(`ABCK=${scripts.abck}`);
    log(`BMS=${scripts.bms ?? 'none'}`);

    const abckSource = await request.getScript(scripts.abck);
    const abckCapture = await captureBodies({
      pageUrl: CEBU_SELECT_URL,
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

    const bodiesToPost = selectBodies(abckCapture.bodies, options.postCount, options.abckPolicy ?? 'all');
    log(`ABCK captured=${abckCapture.bodies.length} posting=${bodiesToPost.length}`);
    for (const [index, body] of bodiesToPost.entries()) {
      await delay(250);
      log(`ABCK POST ${index + 1}/${bodiesToPost.length}`);
      await request.postAbck(scripts.abck, body);
    }

    let bmsPosted = false;
    if (scripts.bms !== undefined) {
      const bmsSource = await request.getScript(scripts.bms);
      const bmsCapture = await captureBodies({
        pageUrl: CEBU_SELECT_URL,
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
    }

    const cookies = request.cookies();
    const abckTilde0 = cookieValue(cookies, '_abck')?.includes('~0~') ?? false;
    const search = options.search === true ? await request.search(options.searchBody) : undefined;
    return {
      profile,
      interactionSeed,
      cookies,
      abckBodyCount: abckCapture.bodies.length,
      abckPostCount: bodiesToPost.length,
      bmsPosted,
      abckTilde0,
      ...(search === undefined ? {} : { search }),
    };
  } finally {
    await request.close();
  }
}

export { CEBU_SEARCH_URL, CEBU_SELECT_URL } from './request.js';
