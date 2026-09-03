import { randomBytes } from 'node:crypto';

export interface ProxyUrlOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol?: 'http' | 'https' | 'socks5' | 'socks5h';
}

export interface LumiProxyOptions {
  customerZone: string;
  password: string;
  country: string;
  sessionId?: string;
  host?: string;
  port?: number;
}

export interface LumiProxy {
  url: string;
  country: string;
  sessionId: string;
  username: string;
}

export interface LumiRelayProxyOptions extends LumiProxyOptions {
  proxyUrl: string;
  clientHelloId: string;
  http2ProfileId?: string;
}

export interface LumiRelayProxy extends LumiProxy {
  relayUrl: string;
  proxyHeaders: Readonly<Record<string, string>>;
}

export function createProxyUrl(options: ProxyUrlOptions): string {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new RangeError('proxy port must be an integer between 1 and 65535');
  }
  if ((options.username === undefined) !== (options.password === undefined)) {
    throw new TypeError('proxy username and password must be provided together');
  }
  const url = new URL(`${options.protocol ?? 'http'}://${options.host}:${options.port}`);
  if (options.username !== undefined && options.password !== undefined) {
    url.username = options.username;
    url.password = options.password;
  }
  return url.href;
}

export function createLumiProxy(options: LumiProxyOptions): LumiProxy {
  const sessionId = options.sessionId ?? randomBytes(8).toString('hex');
  if (!/^[A-Za-z0-9]+$/.test(sessionId)) {
    throw new TypeError('Lumi sessionId must be alphanumeric');
  }
  const username = `${options.customerZone}-country-${options.country}-session-${sessionId}-route_err-block`;
  return {
    url: createProxyUrl({
      host: options.host ?? 'brd.superproxy.io',
      port: options.port ?? 22_225,
      username,
      password: options.password,
    }),
    country: options.country,
    sessionId,
    username,
  };
}

export function createLumiRelayProxy(options: LumiRelayProxyOptions): LumiRelayProxy {
  const lumi = createLumiProxy(options);
  const relayUrl = createProxyUrl({
    host: `servercountry-${options.country}.${options.host ?? 'brd.superproxy.io'}`,
    port: options.port ?? 22_225,
  });
  const relayCredentials = `${lumi.username}:${options.password}`;
  const proxyHeaders: Record<string, string> = {
    'X-ClientHello-Id': options.clientHelloId,
    'X-Relay-ProxyAddr': relayUrl,
    'X-Relay-ProxyAuthorization': `Basic ${Buffer.from(relayCredentials, 'ascii').toString('base64')}`,
  };
  if (options.http2ProfileId !== undefined) {
    proxyHeaders['X-Http2Profile-Id'] = options.http2ProfileId;
  }
  return {
    ...lumi,
    url: options.proxyUrl,
    relayUrl,
    proxyHeaders,
  };
}
