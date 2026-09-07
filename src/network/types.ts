import type { MessagePort } from 'node:worker_threads';

export const NETWORK_BODY_LIMIT = 8 * 1024 * 1024;

export interface ResponseCookie {
  readonly url: string;
  readonly value: string;
  readonly receivedAt?: number;
}

export interface NetworkTransport {
  readonly cookies?: readonly ResponseCookie[];
  request(request: Request): Promise<Response>;
}

/** Host-only transport. It must return each response without following redirects. */
export interface CaptureNetworkOptions {
  readonly allowedUrls: readonly string[];
  readonly cookies?: readonly ResponseCookie[];
  readonly request: (request: Request) => Promise<Response>;
}

export interface NetworkChannel {
  readonly port: MessagePort;
  readonly allowedUrls: readonly string[];
  readonly cookies: readonly ResponseCookie[];
}

export interface WireRequest {
  id: number;
  url: string;
  method: string;
  headers: [string, string][];
  body: Uint8Array | null;
}

export type NetworkRequestMessage = WireRequest | { id: number; cancel: true };
export type NetworkResponseMessage =
  | { id: number; status: number; statusText: string; headers: [string, string][]; body: Uint8Array | null }
  | { id: number; error: string };

export function networkUrl(input: string): string {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('Capture network requires HTTP(S) URLs without credentials');
  }
  url.hash = '';
  return url.href;
}

export function assertNetworkUrl(url: string, allowed: ReadonlySet<string>): void {
  if (!allowed.has(networkUrl(url))) throw new Error(`Capture network URL is not allowed: ${url}`);
}
