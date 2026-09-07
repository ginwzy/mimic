import { MessageChannel } from 'node:worker_threads';
import { assertNetworkUrl, networkUrl, NETWORK_BODY_LIMIT, type CaptureNetworkOptions, type NetworkChannel, type NetworkRequestMessage, type NetworkResponseMessage } from './types.js';

async function responseBody(response: Response, signal: AbortSignal): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  const chunks: Uint8Array[] = [];
  let size = 0;
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > NETWORK_BODY_LIMIT) throw new Error('Capture response exceeds the 8 MiB body limit');
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Owns host I/O for one task, including cancellation on worker exit or watchdog. */
export function hostNetwork(options: CaptureNetworkOptions): { channel: NetworkChannel; close(): void } {
  const allowed = new Set(options.allowedUrls.map(networkUrl));
  if (allowed.size === 0) throw new TypeError('Capture network requires an explicit URL allowlist');
  const cookies = structuredClone(options.cookies ?? []);
  const { port1, port2 } = new MessageChannel();
  const active = new Map<number, AbortController>();
  let closed = false;
  const reply = (message: NetworkResponseMessage) => {
    if (!closed) port1.postMessage(message);
  };
  port1.on('message', async (message: NetworkRequestMessage) => {
    if (closed) return;
    if ('cancel' in message) {
      active.get(message.id)?.abort();
      return;
    }
    const controller = new AbortController();
    active.set(message.id, controller);
    let response: Response | undefined;
    try {
      assertNetworkUrl(message.url, allowed);
      if (message.body && message.body.byteLength > NETWORK_BODY_LIMIT) throw new Error('Capture request exceeds the 8 MiB body limit');
      response = await options.request(new Request(message.url, {
        method: message.method,
        headers: message.headers,
        body: message.body === null ? null : new Uint8Array(message.body),
        signal: controller.signal,
        redirect: 'manual',
      }));
      if (controller.signal.aborted || closed) {
        void response.body?.cancel().catch(() => {});
        return;
      }
      if (response.url && networkUrl(response.url) !== networkUrl(message.url)) {
        throw new Error('Capture network transport followed a redirect; manual responses are required');
      }
      const headers: [string, string][] = [...response.headers].filter(([name]) => name !== 'set-cookie');
      for (const cookie of response.headers.getSetCookie()) headers.push(['set-cookie', cookie]);
      const body = await responseBody(response, controller.signal);
      if (!controller.signal.aborted) reply({
        id: message.id, status: response.status, statusText: response.statusText, headers, body,
      });
    } catch (cause) {
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
      reply({ id: message.id, error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      active.delete(message.id);
    }
  });
  const close = () => {
    if (closed) return;
    closed = true;
    for (const controller of active.values()) controller.abort();
    active.clear();
    port1.close();
    port2.close();
  };
  port1.on('close', close);
  return {
    channel: { port: port2, allowedUrls: [...allowed], cookies },
    close,
  };
}
