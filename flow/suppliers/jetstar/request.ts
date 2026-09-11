import { createHash, randomBytes } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import type { Profile } from '../../../src/core/types.js';
import { createRequestClient, type HeadersInit, type RequestClient, type TextResponse } from '../../client.js';

export const JETSTAR_SITE = 'https://www.jetstar.com';
export const JETSTAR_BOOKING_SITE = 'https://booking.jetstar.com';
export const JETSTAR_SEARCH_URL = `${JETSTAR_BOOKING_SITE}/au/en/booking/search-flights`;
export const JETSTAR_CAPTCHA_URL = `${JETSTAR_BOOKING_SITE}/captcha/adaptivecheck.html`;
export const JETSTAR_SOURCE_URLS = {
  home: `${JETSTAR_SITE}/au/en/home`,
  mmb: `${JETSTAR_BOOKING_SITE}/mmb/?pid=subnav:mmb#/login?culture=en-au`,
  nuance: `${JETSTAR_SITE}/nuance/nuanceChat.html?POST2SERVER`,
} as const;

export type JetstarSource = keyof typeof JETSTAR_SOURCE_URLS;
export interface JetstarSearchOptions {
  origin?: string;
  destination?: string;
  departureDate?: string;
  adults?: number;
  children?: number;
  infants?: number;
  currency?: string;
}
export interface JetstarPage {
  url: string;
  html: string;
  status: number;
}
export interface JetstarSearchResult extends JetstarPage {
  class: string;
  success: boolean;
}
export interface JetstarRequestOptions {
  profile: Profile;
  proxy?: string;
  proxyHeaders?: HeadersInit;
  timeoutMs?: number;
  log?: (message: string) => void;
}
export interface JetstarRequest {
  getSource(source: JetstarSource): Promise<JetstarPage>;
  search(options?: JetstarSearchOptions): Promise<JetstarSearchResult>;
  getCaptcha(parentUrl: string): Promise<JetstarPage>;
  discoverScript(page: JetstarPage, mode: 'bms' | 'abck'): string;
  getScript(url: string, pageUrl: string): Promise<string>;
  postBms(url: string, body: string, pageUrl: string): Promise<void>;
  postAbck(url: string, body: string, pageUrl: string): Promise<void>;
  verifyPow(html: string, documentUrl: string): Promise<void>;
  verifyChallenge(parentUrl: string): Promise<string>;
  cookies(url?: string): string;
  close(): Promise<void>;
}

const DOC_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
const REQUEST_OPTIONS = { redirect: 'manual', disableDefaultHeaders: true } as const;

export function isJetstarChallenge(html: string): boolean {
  return html.includes('data-duration') && html.includes('sec-cpt');
}

function requireSuccess(response: TextResponse, label: string): TextResponse {
  if (response.status < 200 || response.status >= 300) throw new Error(`${label} HTTP ${response.status}`);
  return response;
}

function cookieValue(cookies: string, name: string): string | undefined {
  return cookies.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

interface PowChallenge {
  token: string;
  timestamp: number;
  nonce: string;
  difficulty: number;
  count: number;
}

function parsePowChallenge(value: unknown): PowChallenge {
  const challenge = value as Partial<PowChallenge> | null;
  if (!challenge || typeof challenge.token !== 'string' || typeof challenge.nonce !== 'string'
    || !Number.isSafeInteger(challenge.timestamp) || challenge.timestamp! < 0
    || !Number.isSafeInteger(challenge.difficulty) || challenge.difficulty! < 1
    || !Number.isSafeInteger(challenge.count) || challenge.count! < 1 || challenge.count! > 1000
    || !Number.isSafeInteger(challenge.difficulty! + challenge.count!)) {
    throw new Error('invalid Jetstar sec-cpt challenge');
  }
  return challenge as PowChallenge;
}

async function powPayload(challenge: PowChallenge, cookie: string): Promise<string> {
  const separator = cookie.indexOf('~');
  if (separator < 1) throw new Error('malformed Jetstar sec_cpt cookie');
  const prefix = `${cookie.slice(0, separator)}${challenge.timestamp}${challenge.nonce}`;
  const answers: string[] = [];
  const deadline = Date.now() + 30_000;
  let attempts = 0;
  while (answers.length < challenge.count) {
    const difficulty = challenge.difficulty + answers.length;
    // Same k / 2^53 hexadecimal representation as Chromium Math.random().
    const bits = BigInt(`0x${randomBytes(7).toString('hex')}`) >> 3n;
    const answer = (Number(bits) / 2 ** 53).toString(16);
    const hash = createHash('sha256').update(`${prefix}${difficulty}${answer}`).digest('hex');
    if (BigInt(`0x${hash}`) % BigInt(difficulty) === 0n) answers.push(answer);
    if (++attempts % 1024 === 0) {
      if (Date.now() >= deadline) throw new Error('Jetstar sec-cpt PoW timed out');
      await setImmediate();
    }
  }
  return JSON.stringify({ token: challenge.token, answers });
}

class JetstarRequestClient implements JetstarRequest {
  constructor(
    private readonly client: RequestClient,
    private readonly headers: Readonly<Record<string, string>>,
    private readonly log: (message: string) => void,
  ) {}

  async getSource(source: JetstarSource): Promise<JetstarPage> {
    const url = JETSTAR_SOURCE_URLS[source];
    if (url === undefined) throw new TypeError(`invalid Jetstar source: ${source}`);
    const response = requireSuccess(await this.navigate(url), 'Jetstar source');
    return { url: response.url, html: response.body, status: response.status };
  }

  async search(options: JetstarSearchOptions = {}): Promise<JetstarSearchResult> {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 8);
    const departureDate = options.departureDate ?? date.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate) || new Date(departureDate).toJSON()?.slice(0, 10) !== departureDate) {
      throw new TypeError('departureDate must be a valid YYYY-MM-DD date');
    }
    for (const [name, count] of Object.entries({ adults: options.adults ?? 1, children: options.children ?? 0, infants: options.infants ?? 0 })) {
      if (!Number.isSafeInteger(count) || count < (name === 'adults' ? 1 : 0)) throw new TypeError(`invalid ${name}`);
    }
    const url = new URL(JETSTAR_SEARCH_URL);
    url.search = new URLSearchParams({
      origin1: options.origin ?? 'MEL', destination1: options.destination ?? 'CNS', departuredate1: departureDate,
      adults: String(options.adults ?? 1), children: String(options.children ?? 0), infants: String(options.infants ?? 0),
      Currency: options.currency ?? 'AUD', pid: 'destinations-flights-widget',
    }).toString();
    const response = await this.navigate(url.href, `${JETSTAR_SITE}/`);
    let classification: string;
    if (response.status === 403) classification = 'edge_403';
    else if (response.status < 200 || response.status >= 300) classification = `http_${response.status}`;
    else if (isJetstarChallenge(response.body)) classification = 'sec_cpt';
    else if (/sec-if-cpt-container|sec_sbsd_chlge_form/.test(response.body)) classification = 'challenge';
    // Retain akavm's size heuristic, but never accept an identified challenge by size alone.
    else if (Buffer.byteLength(response.body) >= 15_000) classification = 'large_html';
    else if (/[?&]v=/.test(response.body)) classification = /[?&](?:amp;)?t=/.test(response.body) ? 'bmsc' : 'bms';
    else classification = 'unexpected_page';
    return { url: response.url, html: response.body, status: response.status, class: classification, success: classification === 'large_html' };
  }

  async getCaptcha(parentUrl: string): Promise<JetstarPage> {
    const response = requireSuccess(await this.navigate(JETSTAR_CAPTCHA_URL, parentUrl, true), 'Jetstar captcha');
    return { url: response.url, html: response.body, status: response.status };
  }

  discoverScript(page: JetstarPage, mode: 'bms' | 'abck'): string {
    const document = JSDOM.fragment(page.html);
    const base = new URL(document.querySelector('base[href]')?.getAttribute('href') ?? page.url, page.url);
    const scripts = [...document.querySelectorAll('script')];
    const sources = scripts.filter(script => script.hasAttribute('src')).map(script => new URL(script.getAttribute('src')!, base));
    if (mode === 'bms') {
      const script = sources.reverse().find(url => url.searchParams.has('v'));
      if (!script) throw new Error(`Jetstar bms script not found on ${page.url}`);
      return script.href;
    }
    // Adaptive Check appends a separate deferred controller after ABCK. Both URLs
    // are extensionless; selecting the last such URL executes the wrong script.
    const appath = scripts.filter(script => !script.hasAttribute('src'))
      .map(script => /\b_appath\s*=\s*(["'])(.*?)\1/.exec(script.textContent ?? '')?.[2])
      .reverse().find(value => value !== undefined);
    if (appath !== undefined) {
      const url = new URL(appath, base).href;
      if (!sources.some(source => source.href === url)) throw new Error(`Jetstar _appath has no matching script on ${page.url}`);
      return url;
    }
    // Match akavm's fallback: the penultimate script element, including inline elements.
    const source = scripts.at(-2)?.getAttribute('src');
    const script = source ? new URL(source, base) : undefined;
    if (!script || script.searchParams.has('v') || script.pathname.split('/').at(-1)!.includes('.')) {
      throw new Error(`Jetstar abck script not found on ${page.url}`);
    }
    return script.href;
  }

  async getScript(url: string, pageUrl: string): Promise<string> {
    const response = await this.get(url, {
      accept: '*/*', 'sec-fetch-site': this.fetchSite(url, pageUrl), 'sec-fetch-mode': 'no-cors',
      'sec-fetch-dest': 'script', referer: pageUrl,
    });
    return requireSuccess(response, 'Jetstar script').body;
  }

  async postBms(url: string, body: string, pageUrl: string): Promise<void> {
    const target = new URL(url);
    target.search = '';
    target.hash = '';
    await this.post(target.href, body, pageUrl, 'application/json');
  }

  async postAbck(url: string, body: string, pageUrl: string): Promise<void> {
    await this.post(url, body, pageUrl, 'text/plain;charset=UTF-8');
  }

  async verifyPow(html: string, documentUrl: string): Promise<void> {
    const encoded = JSDOM.fragment(html).querySelector('[challenge]')?.getAttribute('challenge');
    if (!isJetstarChallenge(html) || !encoded) throw new Error('Jetstar sec-cpt challenge data not found');
    let challenge = parsePowChallenge(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')));
    const url = `${JETSTAR_BOOKING_SITE}/_sec/verify?provider=adaptive`;
    for (let round = 0; round < 3; round++) {
      const cookie = cookieValue(this.cookies(url), 'sec_cpt');
      if (!cookie) throw new Error('Jetstar sec_cpt cookie missing before PoW');
      const payload = await powPayload(challenge, cookie);
      const response = await this.post(url, payload, documentUrl, 'text/plain;charset=UTF-8');
      const data: unknown = JSON.parse(response.body);
      if (data && typeof data === 'object' && 'success' in data && data.success === true) return;
      challenge = parsePowChallenge(data);
    }
    throw new Error('Jetstar sec-cpt PoW retry limit exceeded');
  }

  async verifyChallenge(parentUrl: string): Promise<string> {
    const url = `${JETSTAR_BOOKING_SITE}/_sec/cp_challenge/verify`;
    requireSuccess(await this.get(url, {
      accept: '*/*', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty', referer: parentUrl, priority: 'u=1, i',
    }), 'Jetstar challenge verify');
    const state = cookieValue(this.cookies(url), 'sec_cpt')?.split('~')[1];
    if (state !== '3') throw new Error(`Jetstar sec_cpt result: ${state ?? 'missing'}`);
    return state;
  }

  cookies(url = JETSTAR_BOOKING_SITE): string { return this.client.cookieHeader(url); }
  close(): Promise<void> { return this.client.close(); }

  private fetchSite(url: string, pageUrl: string): string {
    return new URL(url).origin === new URL(pageUrl).origin ? 'same-origin' : 'same-site';
  }

  private async navigate(url: string, referer?: string, iframe = false): Promise<TextResponse> {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await this.get(url, {
        'upgrade-insecure-requests': '1', accept: DOC_ACCEPT,
        'sec-fetch-site': iframe ? 'same-origin' : 'same-site', 'sec-fetch-mode': 'navigate',
        ...(iframe ? {} : { 'sec-fetch-user': '?1' }), 'sec-fetch-dest': iframe ? 'iframe' : 'document',
        ...(referer === undefined ? {} : { referer }), priority: 'u=0, i',
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        const finalUrl = new URL(response.url);
        if (!finalUrl.hash) finalUrl.hash = new URL(url).hash;
        return { ...response, url: finalUrl.href };
      }
      const location = response.headers.get('location');
      if (!location) throw new Error('Jetstar redirect missing Location');
      const next = new URL(location, url);
      if (next.protocol !== 'https:' || !next.hostname.endsWith('.jetstar.com')) throw new Error('Jetstar redirect outside HTTPS site');
      if (!location.includes('#')) next.hash = new URL(url).hash;
      url = next.href;
    }
    throw new Error('Jetstar navigation redirect limit exceeded');
  }

  private async get(url: string, headers: Record<string, string>): Promise<TextResponse> {
    this.log(`GET ${url}`);
    const response = await this.client.get(url, { ...this.headers, ...headers }, REQUEST_OPTIONS);
    this.log(`GET HTTP ${response.status} body=${response.body.length}B`);
    return response;
  }

  private async post(url: string, body: string, pageUrl: string, contentType: string): Promise<TextResponse> {
    this.log(`POST ${url} body=${body.length}B`);
    const response = await this.client.post(url, body, {
      ...this.headers, accept: '*/*', 'content-type': contentType, origin: new URL(pageUrl).origin,
      referer: pageUrl, 'sec-fetch-site': this.fetchSite(url, pageUrl), 'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty', priority: 'u=1, i',
    }, REQUEST_OPTIONS);
    this.log(`POST HTTP ${response.status} body=${response.body.length}B`);
    return requireSuccess(response, 'Jetstar POST');
  }
}

export async function createJetstarRequest(options: JetstarRequestOptions): Promise<JetstarRequest> {
  const navigator = options.profile.navigator;
  const client = await createRequestClient({
    browser: 'chrome_145', os: 'android', insecure: true, timeoutMs: options.timeoutMs ?? 60_000,
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
    ...(options.proxyHeaders === undefined ? {} : { proxyHeaders: options.proxyHeaders }),
  });
  return new JetstarRequestClient(client, {
    'user-agent': navigator.userAgent,
    'sec-ch-ua': navigator.userAgentData.brands.map(({ brand, version }) => `${JSON.stringify(brand)};v=${JSON.stringify(version)}`).join(', '),
    'sec-ch-ua-mobile': navigator.userAgentData.mobile ? '?1' : '?0',
    'sec-ch-ua-platform': JSON.stringify(navigator.userAgentData.platform),
    'accept-encoding': 'gzip, deflate, br', 'accept-language': 'en-US,en;q=0.5',
  }, options.log ?? (() => {}));
}
