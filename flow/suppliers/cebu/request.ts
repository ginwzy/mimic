import {
  createRequestClient,
  type HeadersInit,
  type RequestClient,
  type RequestOptions,
  type TextResponse,
} from '../../client.js';

export const CEBU_SITE = 'https://www.cebupacificair.com';
export const CEBU_SELECT_URL = `${CEBU_SITE}/en-PH/booking/select-flight`;
export const CEBU_SEARCH_URL = 'https://soar.cebupacificair.com/ceb-omnix-proxy-v3/availability';

const CHROME_MAJOR = 145;
const UA = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Mobile Safari/537.36`;
const SEC_CH_UA = `"Not;A=Brand";v="8", "Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}"`;
const ACCEPT_LANG = 'en-GB,en-US;q=0.9,en;q=0.8,pl;q=0.7';
const DOC_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
const BROWSER_HEADERS = {
  'user-agent': UA,
  'sec-ch-ua': SEC_CH_UA,
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
} as const;

const SEARCH_HEADER_ORDER = [
  'host', 'content-length', 'user-agent', 'accept', 'accept-encoding', 'content-type',
  'sec-ch-ua-platform', 'x-auth-token', 'authorization', 'x-path', 'sec-ch-ua',
  'sec-ch-ua-mobile', 'origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest',
  'referer', 'accept-language', 'priority', 'cookie',
] as const;

export interface CebuCredentials {
  authorization: string;
  authToken: string;
  path: string;
}

export const CEBU_DEFAULT_CREDENTIALS: CebuCredentials = {
  authorization: 'Bearer ff020ca4a2a0MoV5doJAgndROj90LA3trQleGE',
  authToken: '837bd9b7a6U2FsdGVkX1+v2jUFaYmhWijDL3pyl5Fa0cAtWT4qTfyTcDmYs3UktAk/6Xip/co7QmhmOZscQ/n9FmOGKotA1WSFd6Uo1Hbyr+4TyDl3d26NnQ7HP/n7UtMV/PQBCuFGbgv192DfK+LxsiIQRDmcnInOzkUvFRFmG9BHwpyUYE8131ZItFKgqHcgHIT2oeKR5JZ3urZGfX4QQQpH7O0Tt9QJuvWsI6yY7AyEG2/pVYFgW4D8BVLLW0+7Mryt8p7JUGOEqdX7wIf24xU9rXxh/VjWTbzOBFKPVGSJfVU4HGg=',
  path: 'U2FsdGVkX19lEh6mUmJtjvofU5TNrKriSc6QSUKLV3c=',
};

export const CEBU_DEFAULT_SEARCH_BODY = '{"content":"U2FsdGVkX1++rgeTvC4KykMJNXMS9no1//kQGagNJcFIBev2I3hvbq9PYpRS3P0rheYkpM29yAljeQkee4+GW26MTrimeyjvmZ5cParoSzDOWoLEFGdLkqqH0OOVTx8CgN9xmIfXmuGva4E5u0AprbAQn+y53Slw3HoN4+r3pSoruQ55c27Fhd+5S1r755eAlHmixHDOoZnlFYlil2uCMi8HogrewoYw53VBdMNRv0mjQg+3Quvmmpoukqd+a2owfVmXv1x32Gc39VfQg7599qBfW4IB0VlTZjmt00ZNo6arsAcPVe2c+f52IrWtVyAcOxBzEYwlD9L48vKFNa91IdWtQ837bd9b7a6U2FsdGVkX1+v2jUFaYmhWijDL3pyl5Fa0cAtWT4qTfyTcDmYs3UktAk/6Xip/co7QmhmOZscQ/n9FmOGKotA1WSFd6Uo1Hbyr+4TyDl3d26NnQ7HP/n7UtMV/PQBCuFGbgv192DfK+LxsiIQRDmcnInOzkUvFRFmG9BHwpyUYE8131ZItFKgqHcgHIT2oeKR5JZ3urZGfX4QQQpH7O0Tt9QJuvWsI6yY7AyEG2/pVYFgW4D8BVLLW0+7Mryt8p7JUGOEqdX7wIf24xU9rXxh/VjWTbzOBFKPVGSJfVU4HGg=00bl1Uu+EOl6trV9nAcSttyCdCzJB/8UCj08cg5r95tPNKliv9hJy1u+tSxBpbTHBPWoCCEB1LSIr2fexlzMZDHjUD3wCUEP57HSoxqBs+M0yTCTeKiZUPMJFxNGKff020ca4a2a0MoV5doJAgndROj90LA3trQleGEMtLONGsOToHbcI3p6LXJLelHon55uDE0fgHNe2NtohsHawwRsHJ66rWfGaMbAapGPJTw/VvGefYB7ON6EnENwLZtR/36t/FpsC0dWx050fa2ZPsTNIhYCeUh+ul0Xk8/zKIfePfbWLENpKsSurlUGXbj1FaCc8doXtiqK/EVEO"}';

export interface CebuRequestOptions {
  proxy?: string;
  proxyHeaders?: HeadersInit;
  timeoutMs?: number;
  credentials?: CebuCredentials;
  log?: (message: string) => void;
}

export interface CebuScripts {
  abck: string;
  bms?: string;
}

export interface CebuSearchResult {
  status: number;
  body: string;
  success: boolean;
}

export interface CebuRequest {
  getLanding(): Promise<string>;
  discoverScripts(html: string): CebuScripts;
  getScript(url: string): Promise<string>;
  postAbck(url: string, body: string): Promise<void>;
  postBms(url: string, body: string): Promise<void>;
  search(body?: string): Promise<CebuSearchResult>;
  cookies(url?: string): string;
  close(): Promise<void>;
}

function requireStatus(response: TextResponse, label: string): TextResponse {
  if (response.status >= 400) throw new Error(`${label} HTTP ${response.status}`);
  return response;
}

function withoutQuery(url: string): string {
  const queryIndex = url.indexOf('?');
  return queryIndex < 0 ? url : url.slice(0, queryIndex);
}

class CebuRequestClient implements CebuRequest {
  constructor(
    private readonly client: RequestClient,
    private readonly credentials: CebuCredentials,
    private readonly log: (message: string) => void,
  ) {}

  async getLanding(): Promise<string> {
    const response = await this.get(CEBU_SELECT_URL, {
      ...BROWSER_HEADERS,
      'upgrade-insecure-requests': '1',
      accept: DOC_ACCEPT,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-user': '?1',
      'sec-fetch-dest': 'document',
      'accept-language': ACCEPT_LANG,
    }, 'select-flight');
    return requireStatus(response, 'select-flight').body;
  }

  discoverScripts(html: string): CebuScripts {
    const sources = [...html.matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)]
      .map((match) => match[1])
      .filter((source): source is string => source !== undefined);
    let bmsPath: string | undefined;
    for (let index = sources.length - 1; index >= 0; index -= 1) {
      const source = sources[index];
      if (source !== undefined && /[?&]v=/.test(source)) {
        bmsPath = source;
        break;
      }
    }
    let abckPath: string | undefined;
    if (bmsPath !== undefined) {
      const firstSegment = bmsPath.split('?', 1)[0]?.replace(/^\//, '').split('/', 1)[0];
      if (firstSegment) {
        const prefix = `/${firstSegment}/`;
        abckPath = sources.find((source) => source.startsWith(prefix) && !/[?&]v=/.test(source));
      }
    }
    if (abckPath === undefined) {
      for (let index = sources.length - 1; index >= 0; index -= 1) {
        const source = sources[index];
        if (source === undefined) continue;
        try {
          const url = new URL(source, CEBU_SITE);
          const segments = url.pathname.split('/').filter(Boolean);
          if (source.startsWith('/') && segments.length >= 4 && !segments[segments.length - 1]?.includes('.')) {
            abckPath = source;
            break;
          }
        } catch {
          continue;
        }
      }
    }
    if (abckPath === undefined) throw new Error('abck script not found');
    return {
      abck: new URL(abckPath, CEBU_SITE).href,
      ...(bmsPath === undefined ? {} : { bms: new URL(bmsPath, CEBU_SITE).href }),
    };
  }

  async getScript(url: string): Promise<string> {
    const response = await this.get(url, {
      ...BROWSER_HEADERS,
      accept: '*/*',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-dest': 'script',
      referer: CEBU_SELECT_URL,
      'accept-language': ACCEPT_LANG,
    }, 'script');
    return requireStatus(response, 'script').body;
  }

  async postAbck(url: string, body: string): Promise<void> {
    const response = await this.post(withoutQuery(url), body, {
      ...BROWSER_HEADERS,
      'content-type': 'text/plain;charset=UTF-8',
      accept: DOC_ACCEPT,
      origin: CEBU_SITE,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      referer: CEBU_SELECT_URL,
      'accept-language': ACCEPT_LANG,
    }, '_abck POST');
    requireStatus(response, '_abck POST');
  }

  async postBms(url: string, body: string): Promise<void> {
    const response = await this.post(withoutQuery(url), body, {
      ...BROWSER_HEADERS,
      'content-type': 'application/json',
      accept: 'application/json',
      origin: CEBU_SITE,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      referer: CEBU_SELECT_URL,
      'accept-language': ACCEPT_LANG,
    }, 'BMS POST');
    requireStatus(response, 'BMS POST');
  }

  async search(body = CEBU_DEFAULT_SEARCH_BODY): Promise<CebuSearchResult> {
    const response = await this.post(CEBU_SEARCH_URL, body, {
      ...BROWSER_HEADERS,
      accept: 'application/json, text/plain, */*',
      'accept-encoding': 'gzip, deflate, br, zstd',
      'accept-language': ACCEPT_LANG,
      authorization: this.credentials.authorization,
      'content-type': 'application/json',
      origin: CEBU_SITE,
      priority: 'u=1, i',
      referer: `${CEBU_SITE}/`,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'x-auth-token': this.credentials.authToken,
      'x-path': this.credentials.path,
    }, 'availability POST', {
      cookies: ['_abck', 'bm_s'],
      headerOrder: SEARCH_HEADER_ORDER,
    });
    return { status: response.status, body: response.body, success: response.status === 401 };
  }

  cookies(url: string = CEBU_SITE): string {
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

export async function createCebuRequest(options: CebuRequestOptions = {}): Promise<CebuRequest> {
  const client = await createRequestClient({
    browser: 'chrome_145',
    os: 'android',
    timeoutMs: options.timeoutMs ?? 30_000,
    insecure: true,
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
    ...(options.proxyHeaders === undefined ? {} : { proxyHeaders: options.proxyHeaders }),
  });
  return new CebuRequestClient(
    client,
    options.credentials ?? CEBU_DEFAULT_CREDENTIALS,
    options.log ?? (() => {}),
  );
}
