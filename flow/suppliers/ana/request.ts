import {
  createRequestClient,
  type HeadersInit,
  type RequestClient,
  type RequestOptions,
  type TextResponse,
} from '../../client.js';
import type { CaptureNetworkOptions, ResponseCookie } from '../../../src/network/types.js';
import type { Profile } from '../../../src/core/types.js';

export const ANA_SITE = 'https://www.ana.co.jp';
export const ANA_SELECT_URL = 'https://aswbe.ana.co.jp/webapps/reservation/common/system-error';
export const ANA_FLIGHT_SEARCH_URL = 'https://aswbe.ana.co.jp/webapps/reservation/flight-search?CONNECTION_KIND=JPN&LANG=ja';
export const ANA_VERIFY_URL = 'https://space.ana.co.jp/aswbe-search/api/v1/roundtrip-owd';
export const ANA_SYSDATE_URL = 'https://space.ana.co.jp/sysdate/api/v1/sysdate';
export const ANA_INITIALIZATION_URL = 'https://space.ana.co.jp/aswbe-initialization/api/v1/initialization';
export const ANA_CHANGE_OFFICE_URL = 'https://space.ana.co.jp/aswbe-user/api/v1/change-office-and-lang';

const ASWBE_ORIGIN = 'https://aswbe.ana.co.jp';
const CHROME_MAJOR = 145;
const UA = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Mobile Safari/537.36`;
const SEC_CH_UA = `"Not;A=Brand";v="8", "Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}"`;
const ACCEPT_LANG = 'en-US,en;q=0.9,ja;q=0.8';
const DOC_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
const BROWSER_HEADERS = {
  'user-agent': UA,
  'sec-ch-ua': SEC_CH_UA,
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'accept-encoding': 'gzip, deflate, br, zstd',
} as const;

const FLIGHT_SEARCH_HEADER_ORDER = [
  'host', 'content-length', 'cache-control', 'sec-ch-ua', 'sec-ch-ua-mobile',
  'sec-ch-ua-platform', 'upgrade-insecure-requests', 'content-type', 'user-agent',
  'origin', 'accept', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-user',
  'sec-fetch-dest', 'referer', 'accept-encoding', 'accept-language', 'cookie', 'priority',
] as const;

const VERIFY_HEADER_ORDER = [
  'host', 'content-length', 'user-agent', 'accept', 'accept-encoding', 'content-type',
  'sec-ch-ua-platform', 'authorization', 'sys_id', 'client_id', 'client_secret',
  'identification_id', 'sec-ch-ua', 'sec-ch-ua-mobile', 'origin', 'sec-fetch-site',
  'sec-fetch-mode', 'sec-fetch-dest', 'referer', 'accept-language', 'priority', 'cookie',
] as const;

export const ANA_DEFAULT_VERIFY_BODY = '{"itineraries":[{"originLocationCode":"TYO","destinationLocationCode":"HNL","departureDate":"2026-09-27"}],"travelers":{"ADT":1,"B15":0,"CHD":0,"INF":0},"fare":{"isMixedCabin":false,"cabinClass":"eco","fareOptionType":"0"},"searchPreferences":{"getAirCalendarOnly":false,"getLatestOperation":true}}';
export const ANA_FLIGHT_SEARCH_BODY = 'search=true&trip=roundtrip&origin=HND&destination=NRT&cabinClass=eco&fareOption=21&departureDate=2026-09-03&returnDate=2026-09-04&ADT=1&B15=0&CHD=0&INF=0&promotionCode=&flexibleDates=false';
/** SPA bootstrap bodies from HAR ana.co.jp_2026_09_08_13_38_57; userAgent follows this client's UA. */
export const ANA_INITIALIZATION_BODY = JSON.stringify({
  connectionKind: 'JPN',
  lang: 'ja',
  userAgent: UA,
});
export const ANA_CHANGE_OFFICE_BODY = '{"pointOfSaleId":"TYONH08DD"}';

export interface AnaCredentials {
  authorization: string;
  clientId: string;
  clientSecret: string;
  identificationId: string;
  sysId: string;
}

export const ANA_DEFAULT_CREDENTIALS: AnaCredentials = {
  authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2FuYS5jby5qcCIsInV1aWQiOiJlOWRmODgxZC1kN2ZmLTQ4MWQtOWMwMS04MDU3MzM1NWIxZDUifQ.Z_HMxeLIGwoQFrbg9Dp89FuNTrrbQkPEkctpAWuFxuQ',
  clientId: 'd4df2b8bcfdc47cc9005bde719f3e9c0',
  clientSecret: 'BeBb2FE567eb400e8C70145F6ad4D5d0',
  identificationId: 'a19d5424-de0e-4d5c-b784-557a512f5737',
  sysId: 'ABE',
};

export interface AnaRequestOptions {
  profile?: Profile;
  proxy?: string;
  proxyHeaders?: HeadersInit;
  timeoutMs?: number;
  credentials?: AnaCredentials;
  log?: (message: string) => void;
  closedLoop?: boolean;
}

export interface AnaScripts {
  abck: string;
  bms: string;
}

export interface AnaVerifyResult {
  status: number;
  body: string;
  class: string;
  success: boolean;
}

export interface AnaRequest {
  captureNetwork(url: string, pageUrl: string): CaptureNetworkOptions;
  getWwwHome(): Promise<string>;
  getLanding(): Promise<string>;
  discoverScripts(html: string, pageUrl?: string): AnaScripts;
  getScript(url: string, referer?: string): Promise<string>;
  postAbck(url: string, body: string, referer?: string): Promise<void>;
  postBms(url: string, body: string, referer?: string): Promise<void>;
  postFlightSearch(): Promise<string>;
  getSysdate(query?: string): Promise<void>;
  postInitialization(body?: string): Promise<void>;
  postChangeOfficeAndLang(body?: string): Promise<void>;
  verify(body?: string): Promise<AnaVerifyResult>;
  cookies(url?: string): string;
  close(): Promise<void>;
}

function requireStatus(response: TextResponse, label: string): TextResponse {
  if (response.status >= 400) throw new Error(`${label} HTTP ${response.status}`);
  return response;
}

function classifyVerifyResponse(status: number, body: string): string {
  if (status === 403) return 'edge_403';
  if (status >= 200 && status < 300 && body.length > 0) return 'ok_2xx';
  if (body.includes('Processing')) return 'soft_blocked_processing';
  return `verify_${status}`;
}

function withoutQuery(url: string): string {
  const queryIndex = url.indexOf('?');
  return queryIndex < 0 ? url : url.slice(0, queryIndex);
}

class AnaRequestClient implements AnaRequest {
  private readonly responseCookies: ResponseCookie[] = [];
  constructor(
    private readonly client: RequestClient,
    private readonly credentials: AnaCredentials,
    private readonly log: (message: string) => void,
    private readonly closedLoop: boolean,
    private readonly browserHeaders: Readonly<Record<string, string>>,
  ) {}

  captureNetwork(url: string, pageUrl: string): CaptureNetworkOptions {
    if (!this.closedLoop) throw new Error('ANA closed-loop transport was not enabled');
    if (new URL(url).origin !== new URL(pageUrl).origin) {
      throw new Error('ANA closed-loop currently requires same-origin sensor endpoints');
    }
    return {
      allowedUrls: [...new Set([url, withoutQuery(url)])],
      cookies: [...this.responseCookies],
      request: async (request) => {
        const requestBody = request.body === null ? undefined : new Uint8Array(await request.arrayBuffer());
        const requestHeaders = Object.fromEntries(request.headers);
        const response = await this.client.request(request.method, request.url, requestBody, {
          ...requestHeaders, ...this.browserHeaders,
          cookie: requestHeaders.cookie ?? '',
        }, { signal: request.signal, redirect: 'manual', disableDefaultHeaders: true });
        this.rememberCookies(response);
        const responseHeaders = new globalThis.Headers();
        for (const [name, value] of response.headers) {
          if (name.toLowerCase() !== 'set-cookie') responseHeaders.append(name, value);
        }
        for (const cookie of response.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
        return new Response(
          [204, 205, 304].includes(response.status) || request.method === 'HEAD' ? null : response.body,
          { status: response.status, statusText: response.statusText ?? '', headers: responseHeaders },
        );
      },
    };
  }

  private rememberCookies(response: TextResponse): void {
    for (const value of response.headers.getSetCookie()) {
      this.responseCookies.push({ url: response.url, value, receivedAt: Date.now() });
    }
  }

  async getWwwHome(): Promise<string> {
    const response = await this.get(ANA_SITE, {
      ...this.browserHeaders,
      'upgrade-insecure-requests': '1',
      accept: DOC_ACCEPT,
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-user': '?1',
      'sec-fetch-dest': 'document',
      'accept-language': ACCEPT_LANG,
    }, 'www-home');
    return requireStatus(response, 'www-home').body;
  }

  async getLanding(): Promise<string> {
    const response = await this.get(ANA_SELECT_URL, {
      ...this.browserHeaders,
      'upgrade-insecure-requests': '1',
      accept: DOC_ACCEPT,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-user': '?1',
      'sec-fetch-dest': 'document',
      'accept-language': ACCEPT_LANG,
    }, 'landing');
    return requireStatus(response, 'landing').body;
  }

  discoverScripts(html: string, pageUrl = ANA_SELECT_URL): AnaScripts {
    // Real Akamai pair only: BMS has ?v=/&v=, ABCK shares the same first path segment
    // without a version query (and without a .js filename). Business pages like the
    // ASW-0060 ご案内 shell expose com_optimize.js + font.js and must not match.
    const scripts = [...html.matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)]
      .map((match) => match[1])
      .filter((source): source is string => source !== undefined);

    let bmsPath: string | undefined;
    for (let index = scripts.length - 1; index >= 0; index -= 1) {
      const source = scripts[index];
      if (source !== undefined && /[?&]v=/.test(source)) {
        bmsPath = source;
        break;
      }
    }
    if (bmsPath === undefined) throw new Error('bms script not found');

    const scriptPathname = (source: string): string => {
      const bare = source.split(/[?#]/, 1)[0] ?? source;
      try {
        return bare.includes('://') ? new URL(bare).pathname : bare;
      } catch {
        return bare;
      }
    };

    const firstSegment = scriptPathname(bmsPath).replace(/^\//, '').split('/', 1)[0];
    if (!firstSegment) throw new Error('abck script not found');
    const prefix = `/${firstSegment}/`;
    const abckPath = scripts.find((source) => {
      if (/[?&]v=/.test(source)) return false;
      const pathname = scriptPathname(source);
      const leaf = pathname.split('/').filter(Boolean).at(-1) ?? '';
      return pathname.startsWith(prefix) && !leaf.includes('.');
    });
    if (abckPath === undefined) throw new Error('abck script not found');

    const baseMatch = /<base[^>]*\shref\s*=\s*["']([^"']+)["']/i.exec(html);
    const base = new URL(baseMatch?.[1] ?? pageUrl, pageUrl);
    const bms = new URL(bmsPath, base).href;
    const abck = new URL(abckPath, base).href;
    if (bms === abck) throw new Error('landing page resolved identical BMS and ABCK scripts');
    return { abck, bms };
  }

  async getScript(url: string, referer = ANA_SELECT_URL): Promise<string> {
    const response = await this.get(url, {
      ...this.browserHeaders,
      accept: '*/*',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-dest': 'script',
      referer,
      'accept-language': ACCEPT_LANG,
    }, 'script');
    return requireStatus(response, 'script').body;
  }

  async postAbck(url: string, body: string, referer = ANA_SELECT_URL): Promise<void> {
    const response = await this.post(withoutQuery(url), body, {
      ...this.browserHeaders,
      'content-type': 'text/plain;charset=UTF-8',
      accept: '*/*',
      origin: ASWBE_ORIGIN,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      referer,
      'accept-language': ACCEPT_LANG,
    }, '_abck POST');
    requireStatus(response, '_abck POST');
  }

  async postBms(url: string, body: string, referer = ANA_SELECT_URL): Promise<void> {
    const response = await this.post(withoutQuery(url), body, {
      ...this.browserHeaders,
      'content-type': 'application/json',
      accept: 'application/json',
      origin: new URL(referer).origin,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      referer,
      'accept-language': ACCEPT_LANG,
    }, 'BMS POST');
    if (response.status < 200 || response.status >= 300) throw new Error(`BMS POST HTTP ${response.status}`);
  }

  async postFlightSearch(): Promise<string> {
    const response = await this.post(ANA_FLIGHT_SEARCH_URL, ANA_FLIGHT_SEARCH_BODY, {
      ...this.browserHeaders,
      'cache-control': 'max-age=0',
      'upgrade-insecure-requests': '1',
      'content-type': 'application/x-www-form-urlencoded',
      origin: ANA_SITE,
      accept: DOC_ACCEPT,
      'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-user': '?1',
      'sec-fetch-dest': 'document',
      referer: `${ANA_SITE}/`,
      'accept-encoding': 'gzip, deflate, br, zstd',
      'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      priority: 'u=0, i',
    }, 'flight-search POST', { headerOrder: FLIGHT_SEARCH_HEADER_ORDER });
    return requireStatus(response, 'flight-search POST').body;
  }

  private spaceApiHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...this.browserHeaders,
      accept: 'application/json',
      'accept-language': ACCEPT_LANG,
      authorization: this.credentials.authorization,
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      identification_id: this.credentials.identificationId,
      origin: ASWBE_ORIGIN,
      referer: `${ASWBE_ORIGIN}/`,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      sys_id: this.credentials.sysId,
      priority: 'u=1, i',
      ...extra,
    };
  }

  async getSysdate(query = ''): Promise<void> {
    let url = ANA_SYSDATE_URL;
    if (query.length > 0) {
      url += query.startsWith('?') ? query : `?${query}`;
    }
    const response = await this.get(url, this.spaceApiHeaders({
      accept: '*/*',
    }), 'sysdate GET');
    requireStatus(response, 'sysdate GET');
  }

  async postInitialization(body?: string): Promise<void> {
    const payload = body ?? JSON.stringify({
      connectionKind: 'JPN',
      lang: 'ja',
      userAgent: this.browserHeaders['user-agent'] ?? UA,
    });
    const response = await this.post(ANA_INITIALIZATION_URL, payload, this.spaceApiHeaders({
      'content-type': 'application/json',
    }), 'initialization POST');
    // Soft: keep going for Akamai flow-gap probes even if SPA rejects the body.
    this.log(`initialization POST class=${response.status >= 400 ? 'http_error' : 'ok'} status=${response.status}`);
  }

  async postChangeOfficeAndLang(body = ANA_CHANGE_OFFICE_BODY): Promise<void> {
    const response = await this.post(ANA_CHANGE_OFFICE_URL, body, this.spaceApiHeaders({
      'content-type': 'application/json',
    }), 'change-office POST');
    // Soft: same as initialization — non-2xx must not block verify.
    this.log(`change-office POST class=${response.status >= 400 ? 'http_error' : 'ok'} status=${response.status}`);
  }

  async verify(body = ANA_DEFAULT_VERIFY_BODY): Promise<AnaVerifyResult> {
    const cookieNames = this.client.cookieHeader(ANA_VERIFY_URL).split('; ').flatMap((cookie) => {
      const index = cookie.indexOf('=');
      return index < 0 ? [] : [cookie.slice(0, index)];
    });
    const response = await this.post(ANA_VERIFY_URL, body, {
      ...this.browserHeaders,
      accept: 'application/json',
      'accept-encoding': 'gzip, deflate, br, zstd',
      'accept-language': ACCEPT_LANG,
      authorization: this.credentials.authorization,
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      'content-type': 'application/json',
      identification_id: this.credentials.identificationId,
      origin: ASWBE_ORIGIN,
      referer: `${ASWBE_ORIGIN}/`,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      sys_id: this.credentials.sysId,
      priority: 'u=1, i',
    }, 'roundtrip-owd POST', { cookies: cookieNames, headerOrder: VERIFY_HEADER_ORDER });
    const classification = classifyVerifyResponse(response.status, response.body);
    return {
      status: response.status,
      body: response.body,
      class: classification,
      success: classification === 'ok_2xx' || response.status === 401,
    };
  }

  cookies(url: string = ANA_SITE): string {
    return this.client.cookieHeader(url);
  }

  close(): Promise<void> {
    return this.client.close();
  }

  private async get(url: string, headers: Record<string, string>, label: string): Promise<TextResponse> {
    if (this.closedLoop) {
      for (let redirects = 0; redirects <= 10; redirects++) {
        this.log(`GET ${url}`);
        const response = await this.client.get(url, headers, { redirect: 'manual', disableDefaultHeaders: true });
        this.rememberCookies(response);
        this.log(`${label} HTTP ${response.status} body=${response.body.length}B`);
        const location = response.headers.get('location');
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
        const next = new URL(location, url);
        if (next.protocol !== 'https:' || !next.hostname.endsWith('.ana.co.jp')) {
          throw new Error('ANA initial-page redirect is outside the allowed HTTPS site');
        }
        url = next.href;
      }
      throw new Error('ANA initial-page redirect limit exceeded');
    }
    this.log(`GET ${url}`);
    const response = await this.client.get(url, headers, { disableDefaultHeaders: true });
    this.log(`${label} HTTP ${response.status} body=${response.body.length}B`);
    return response;
  }

  private async post(
    url: string,
    body: string,
    headers: Record<string, string>,
    label: string,
    options?: RequestOptions,
  ): Promise<TextResponse> {
    this.log(`${label} ${url} body=${body.length}B`);
    const response = await this.client.post(url, body, headers, { ...options, disableDefaultHeaders: true });
    this.log(`${label} HTTP ${response.status} resp=${response.body.length}B`);
    return response;
  }
}

export async function createAnaRequest(options: AnaRequestOptions = {}): Promise<AnaRequest> {
  const navigator = options.profile?.navigator;
  const browserHeaders = navigator === undefined ? BROWSER_HEADERS : {
    ...BROWSER_HEADERS,
    'user-agent': navigator.userAgent,
    'sec-ch-ua': navigator.userAgentData.brands.map(({ brand, version }) => (
      `${JSON.stringify(brand)};v=${JSON.stringify(version)}`
    )).join(', '),
    'sec-ch-ua-mobile': navigator.userAgentData.mobile ? '?1' : '?0',
    'sec-ch-ua-platform': JSON.stringify(navigator.userAgentData.platform),
  };
  const client = await createRequestClient({
    browser: 'chrome_145',
    os: 'android',
    timeoutMs: options.timeoutMs ?? 30_000,
    insecure: true,
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
    ...(options.proxyHeaders === undefined ? {} : { proxyHeaders: options.proxyHeaders }),
  });
  return new AnaRequestClient(
    client,
    options.credentials ?? ANA_DEFAULT_CREDENTIALS,
    options.log ?? (() => {}),
    options.closedLoop ?? false,
    browserHeaders,
  );
}
