import {
  createRequestClient,
  type HeadersInit,
  type RequestClient,
  type RequestOptions,
  type TextResponse,
} from '../../client.js';

export const ANA_SITE = 'https://www.ana.co.jp';
export const ANA_SELECT_URL = 'https://aswbe.ana.co.jp/webapps/reservation/common/system-error';
export const ANA_VERIFY_URL = 'https://space.ana.co.jp/aswbe-search/api/v1/roundtrip-owd';

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
} as const;

const VERIFY_HEADER_ORDER = [
  'host', 'content-length', 'user-agent', 'accept', 'accept-encoding', 'content-type',
  'sec-ch-ua-platform', 'authorization', 'sys_id', 'client_id', 'client_secret',
  'identification_id', 'sec-ch-ua', 'sec-ch-ua-mobile', 'origin', 'sec-fetch-site',
  'sec-fetch-mode', 'sec-fetch-dest', 'referer', 'accept-language', 'priority', 'cookie',
] as const;

export const ANA_DEFAULT_VERIFY_BODY = '{"itineraries":[{"originLocationCode":"TYO","destinationLocationCode":"HNL","departureDate":"2026-09-27"}],"travelers":{"ADT":1,"B15":0,"CHD":0,"INF":0},"fare":{"isMixedCabin":false,"cabinClass":"eco","fareOptionType":"0"},"searchPreferences":{"getAirCalendarOnly":false,"getLatestOperation":true}}';

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
  proxy?: string;
  proxyHeaders?: HeadersInit;
  timeoutMs?: number;
  credentials?: AnaCredentials;
  log?: (message: string) => void;
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
  getLanding(): Promise<string>;
  discoverScripts(html: string): AnaScripts;
  getScript(url: string): Promise<string>;
  postAbck(url: string, body: string): Promise<void>;
  postBms(url: string, body: string): Promise<void>;
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
  constructor(
    private readonly client: RequestClient,
    private readonly credentials: AnaCredentials,
    private readonly log: (message: string) => void,
  ) {}

  async getLanding(): Promise<string> {
    const response = await this.get(ANA_SELECT_URL, {
      ...BROWSER_HEADERS,
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

  discoverScripts(html: string): AnaScripts {
    const scripts = [...html.matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)]
      .map((match) => match[1])
      .filter((source): source is string => source !== undefined);
    if (scripts.length < 2) throw new Error('landing page has fewer than two scripts');
    let bmsIndex = scripts.length - 1;
    for (let index = scripts.length - 1; index >= 0; index -= 1) {
      const source = scripts[index];
      if (source !== undefined && (source.includes('?v=') || source.includes('&v='))) {
        bmsIndex = index;
        break;
      }
    }
    const abckIndex = bmsIndex === scripts.length - 1 ? scripts.length - 2 : scripts.length - 1;
    const baseMatch = /<base[^>]*\shref\s*=\s*["']([^"']+)["']/i.exec(html);
    const base = new URL(baseMatch?.[1] ?? ANA_SELECT_URL, ANA_SELECT_URL);
    const bms = new URL(scripts[bmsIndex] as string, base).href;
    const abck = new URL(scripts[abckIndex] as string, base).href;
    if (bms === abck) throw new Error('landing page resolved identical BMS and ABCK scripts');
    return { abck, bms };
  }

  async getScript(url: string): Promise<string> {
    const response = await this.get(url, {
      ...BROWSER_HEADERS,
      accept: '*/*',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-dest': 'script',
      referer: ANA_SELECT_URL,
      'accept-language': ACCEPT_LANG,
    }, 'script');
    return requireStatus(response, 'script').body;
  }

  async postAbck(url: string, body: string): Promise<void> {
    const response = await this.post(withoutQuery(url), body, {
      ...BROWSER_HEADERS,
      'content-type': 'text/plain;charset=UTF-8',
      accept: DOC_ACCEPT,
      origin: ANA_SITE,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      referer: ANA_SELECT_URL,
      'accept-language': ACCEPT_LANG,
    }, '_abck POST');
    requireStatus(response, '_abck POST');
  }

  async postBms(url: string, body: string): Promise<void> {
    const response = await this.post(withoutQuery(url), body, {
      ...BROWSER_HEADERS,
      'content-type': 'application/json',
      accept: 'application/json',
      origin: ANA_SITE,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      referer: ANA_SELECT_URL,
      'accept-language': ACCEPT_LANG,
    }, 'BMS POST');
    requireStatus(response, 'BMS POST');
  }

  async verify(body = ANA_DEFAULT_VERIFY_BODY): Promise<AnaVerifyResult> {
    const cookieNames = this.client.cookieHeader(ANA_VERIFY_URL).split('; ').flatMap((cookie) => {
      const index = cookie.indexOf('=');
      return index < 0 ? [] : [cookie.slice(0, index)];
    });
    const response = await this.post(ANA_VERIFY_URL, body, {
      ...BROWSER_HEADERS,
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
      success: classification === 'ok_2xx',
    };
  }

  cookies(url: string = ANA_SITE): string {
    return this.client.cookieHeader(url);
  }

  close(): Promise<void> {
    return this.client.close();
  }

  private async get(url: string, headers: Record<string, string>, label: string): Promise<TextResponse> {
    this.log(`GET ${url}`);
    const response = await this.client.get(url, headers);
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
    const response = await this.client.post(url, body, headers, options);
    this.log(`${label} HTTP ${response.status} resp=${response.body.length}B`);
    return response;
  }
}

export async function createAnaRequest(options: AnaRequestOptions = {}): Promise<AnaRequest> {
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
  );
}
