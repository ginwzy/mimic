import {
  Headers,
  createSession,
  createTransport,
  fetch as freqFetch,
  type BrowserProfile,
  type EmulationOS,
  type HeadersInit,
  type Session,
  type Transport,
} from '@zionsssx/freq-js';

export interface RequestClientOptions {
  browser?: BrowserProfile;
  os?: EmulationOS;
  proxy?: string;
  proxyHeaders?: HeadersInit;
  timeoutMs?: number;
  insecure?: boolean;
}

export interface RequestOptions {
  cookies?: 'session' | 'none' | readonly string[];
  headerOrder?: readonly string[];
  signal?: AbortSignal;
}

export interface TextResponse {
  status: number;
  url: string;
  headers: Headers;
  body: string;
}

export interface RequestClient {
  get(url: string | URL, headers?: HeadersInit, options?: RequestOptions): Promise<TextResponse>;
  post(
    url: string | URL,
    body: string | Uint8Array,
    headers?: HeadersInit,
    options?: RequestOptions,
  ): Promise<TextResponse>;
  cookieHeader(url: string | URL, names?: readonly string[]): string;
  close(): Promise<void>;
}

interface NormalizedOptions {
  browser: BrowserProfile;
  os: EmulationOS;
  timeoutMs: number;
  insecure: boolean;
  proxy?: string;
  proxyHeaders?: HeadersInit;
}

function transportOptions(options: NormalizedOptions, headerOrder?: readonly string[]) {
  return {
    browser: options.browser,
    os: options.os,
    timeout: options.timeoutMs,
    insecure: options.insecure,
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
    ...(options.proxyHeaders === undefined ? {} : { proxyHeaders: options.proxyHeaders }),
    ...(headerOrder === undefined ? {} : {
      emulation: { origHeaders: [...headerOrder] },
    }),
  };
}

class FreqRequestClient implements RequestClient {
  private closed = false;

  constructor(
    private readonly options: NormalizedOptions,
    private readonly session: Session,
    private readonly transport: Transport,
  ) {}

  get(url: string | URL, headers?: HeadersInit, options?: RequestOptions): Promise<TextResponse> {
    return this.request('GET', url, undefined, headers, options);
  }

  post(
    url: string | URL,
    body: string | Uint8Array,
    headers?: HeadersInit,
    options?: RequestOptions,
  ): Promise<TextResponse> {
    return this.request('POST', url, body, headers, options);
  }

  cookieHeader(url: string | URL, names?: readonly string[]): string {
    this.ensureOpen();
    const cookies = this.session.getCookies(url);
    const selected = names === undefined
      ? Object.entries(cookies)
      : names.flatMap((name) => cookies[name] === undefined ? [] : [[name, cookies[name]] as const]);
    return selected.map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([this.session.close(), this.transport.close()]);
  }

  private async request(
    method: 'GET' | 'POST',
    url: string | URL,
    body: string | Uint8Array | undefined,
    requestHeaders: HeadersInit | undefined,
    requestOptions: RequestOptions | undefined,
  ): Promise<TextResponse> {
    this.ensureOpen();
    const headerOrder = requestOptions?.headerOrder;
    const orderedTransport = headerOrder === undefined
      ? undefined
      : await createTransport(transportOptions(this.options, headerOrder));
    try {
      const headers = new Headers(requestHeaders);
      const cookiePolicy = requestOptions?.cookies ?? 'session';
      if (Array.isArray(cookiePolicy)) {
        const cookie = this.cookieHeader(url, cookiePolicy);
        if (cookie.length > 0) headers.set('cookie', cookie);
      }

      const init = {
        method,
        headers,
        transport: orderedTransport ?? this.transport,
        timeout: this.options.timeoutMs,
        ...(headerOrder === undefined ? {} : { disableDefaultHeaders: true }),
        ...(body === undefined ? {} : { body }),
        ...(requestOptions?.signal === undefined ? {} : { signal: requestOptions.signal }),
      };
      const response = cookiePolicy === 'session'
        ? await this.session.fetch(url, init)
        : await freqFetch(url, init);
      return {
        status: response.status,
        url: response.url,
        headers: response.headers,
        body: await response.text(),
      };
    } finally {
      if (orderedTransport !== undefined) await orderedTransport.close();
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('RequestClient is closed');
  }
}

export async function createRequestClient(options: RequestClientOptions = {}): Promise<RequestClient> {
  const normalized: NormalizedOptions = {
    browser: options.browser ?? 'chrome_145',
    os: options.os ?? 'android',
    timeoutMs: options.timeoutMs ?? 30_000,
    insecure: options.insecure ?? false,
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
    ...(options.proxyHeaders === undefined ? {} : { proxyHeaders: options.proxyHeaders }),
  };
  const transport = await createTransport(transportOptions(normalized));
  try {
    const session = await createSession();
    return new FreqRequestClient(normalized, session, transport);
  } catch (error) {
    await transport.close();
    throw error;
  }
}

export type { BrowserProfile, EmulationOS, HeadersInit } from '@zionsssx/freq-js';
