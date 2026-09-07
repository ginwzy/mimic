import { assertNetworkUrl, networkUrl, NETWORK_BODY_LIMIT, type NetworkChannel, type NetworkRequestMessage, type NetworkResponseMessage } from './types.js';

export function workerNetwork(channel: NetworkChannel) {
  const allowed = new Set(channel.allowedUrls.map(networkUrl));
  const pending = new Map<number, { resolve(response: Response): void; reject(error: Error): void }>();
  let sequence = 0;
  let closed = false;
  channel.port.on('message', (message: NetworkResponseMessage) => {
    const request = pending.get(message.id);
    if (!request) return;
    try {
      if ('error' in message) throw new Error(message.error);
      request.resolve(new Response(message.body === null ? null : new Uint8Array(message.body), {
        status: message.status, statusText: message.statusText, headers: message.headers,
      }));
    } catch (cause) {
      request.reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
  const send = (message: NetworkRequestMessage) => channel.port.postMessage(message);
  const close = () => {
    if (closed) return;
    closed = true;
    for (const request of pending.values()) request.reject(new Error('Capture network closed'));
    pending.clear();
    channel.port.close();
  };
  channel.port.on('close', close);
  return {
    cookies: channel.cookies,
    close,
    async request(request: Request): Promise<Response> {
      if (closed) throw new Error('Capture network closed');
      assertNetworkUrl(request.url, allowed);
      request.signal.throwIfAborted();
      const body = request.body === null ? null : new Uint8Array(await request.arrayBuffer());
      request.signal.throwIfAborted();
      if (closed) throw new Error('Capture network closed');
      if (body && body.byteLength > NETWORK_BODY_LIMIT) throw new Error('Capture request exceeds the 8 MiB body limit');
      const id = ++sequence;
      let abort: () => void = () => {};
      try {
        return await new Promise<Response>((resolve, reject) => {
          pending.set(id, { resolve, reject });
          abort = () => {
            if (!closed) send({ id, cancel: true });
            reject(new Error('Capture request aborted'));
          };
          request.signal.addEventListener('abort', abort, { once: true });
          send({ id, url: request.url, method: request.method, headers: [...request.headers], body });
        });
      } finally {
        pending.delete(id);
        request.signal.removeEventListener('abort', abort);
      }
    },
  };
}
