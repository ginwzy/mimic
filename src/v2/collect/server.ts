import { readFile } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MimicError } from '../core/error.js';
import { DEFAULT_PROBE_PATH } from '../node/assets.js';
import { CollectStore } from './store.js';

export const DEFAULT_COLLECT_PORT = 8970;
export const DEFAULT_COLLECT_MAX_BODY_BYTES = 32 * 1024 * 1024;

export interface CollectServerOptions {
  readonly root: string;
  readonly probePath?: string;
  readonly host?: string;
  readonly port?: number;
  readonly maxBodyBytes?: number;
}

export interface CollectServerHandle {
  readonly server: http.Server;
  readonly store: CollectStore;
  close(): Promise<void>;
}

class RequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.code = code;
  }
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>mimic collect</title>
  <style>
    body { margin: 0; padding: 24px; color: #e7e7e7; background: #151515; font: 15px/1.5 system-ui, sans-serif; }
    main { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 20px; }
    #status { min-height: 24px; }
    textarea { box-sizing: border-box; width: 100%; min-height: 60vh; padding: 12px; color: #b8f8c5; background: #080808; border: 1px solid #444; border-radius: 6px; font: 12px/1.45 ui-monospace, monospace; }
  </style>
</head>
<body>
  <main>
    <h1>mimic collect</h1>
    <p id="status">Collecting...</p>
    <textarea id="output" readonly></textarea>
  </main>
  <script src="/probe.js"></script>
  <script type="module">
    import collectIdentity from '/identity.js';

    const status = document.getElementById('status');
    const output = document.getElementById('output');
    try {
      const rawProbe = window.__probe__();
      if (!rawProbe || typeof rawProbe !== 'object') throw new TypeError('probe returned no snapshot');
      const rawMeta = rawProbe.meta && typeof rawProbe.meta === 'object' ? rawProbe.meta : {};
      const probeSnapshot = { ...rawProbe, meta: { ...rawMeta, ua: navigator.userAgent } };
      const profileRaw = await collectIdentity();
      const response = await fetch('/collect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profileRaw, probeSnapshot }),
      });
      const receipt = await response.json();
      if (!response.ok) throw new Error(receipt?.error?.message || 'collect failed');
      output.value = JSON.stringify(receipt, null, 2);
      status.textContent = 'Collected';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  </script>
</body>
</html>
`;

const identityPath = fileURLToPath(new URL('./browser.js', import.meta.url));

function integer(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
}

function contentType(request: IncomingMessage): void {
  const raw = request.headers['content-type'];
  const media = raw?.split(';', 1)[0]?.trim().toLowerCase();
  if (media !== 'application/json') {
    request.resume();
    throw new RequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'content-type must be application/json');
  }
}

function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = request.headers['content-length'];
    if (declared !== undefined) {
      if (!/^(0|[1-9]\d*)$/.test(declared)) {
        request.resume();
        reject(new RequestError(400, 'BAD_CONTENT_LENGTH', 'content-length must be a non-negative integer'));
        return;
      }
      const length = Number(declared);
      if (!Number.isSafeInteger(length)) {
        request.resume();
        reject(new RequestError(400, 'BAD_CONTENT_LENGTH', 'content-length exceeds the safe integer range'));
        return;
      }
      if (length > maxBytes) {
        request.resume();
        reject(new RequestError(413, 'BODY_TOO_LARGE', `request body exceeds ${maxBytes} bytes`));
        return;
      }
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      request.resume();
      reject(error);
    };

    request.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxBytes) {
        fail(new RequestError(413, 'BODY_TOO_LARGE', `request body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) {
        reject(new RequestError(400, 'BAD_JSON', 'request body must contain JSON'));
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(new RequestError(400, 'BAD_JSON', 'request body must be valid JSON'));
      }
    });
    request.on('aborted', () => fail(new RequestError(400, 'REQUEST_ABORTED', 'request body was aborted')));
    request.on('error', (error) => fail(error));
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, status: number, type: string, body: string): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function wireError(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function startCollectServer(options: CollectServerOptions): CollectServerHandle {
  const {
    root,
    probePath = DEFAULT_PROBE_PATH,
    host = '0.0.0.0',
    port = DEFAULT_COLLECT_PORT,
    maxBodyBytes = DEFAULT_COLLECT_MAX_BODY_BYTES,
  } = options;
  if (typeof host !== 'string' || !host.trim()) throw new TypeError('host must be a non-empty string');
  if (typeof probePath !== 'string' || !probePath || probePath.includes('\0')) {
    throw new TypeError('probePath must be a valid path');
  }
  integer(port, 'port', 0, 65_535);
  integer(maxBodyBytes, 'maxBodyBytes', 1, Number.MAX_SAFE_INTEGER);

  const store = new CollectStore(root);
  const resolvedProbePath = path.resolve(probePath);
  const server = http.createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (request.method === 'GET' && pathname === '/') {
        sendText(response, 200, 'text/html; charset=utf-8', PAGE);
        return;
      }
      if (request.method === 'GET' && pathname === '/identity.js') {
        sendText(response, 200, 'text/javascript; charset=utf-8', await readFile(identityPath, 'utf8'));
        return;
      }
      if (request.method === 'GET' && pathname === '/probe.js') {
        sendText(response, 200, 'text/javascript; charset=utf-8', await readFile(resolvedProbePath, 'utf8'));
        return;
      }
      if (request.method === 'POST' && pathname === '/collect') {
        contentType(request);
        sendJson(response, 201, await store.append(await readJson(request, maxBodyBytes)));
        return;
      }
      request.resume();
      sendJson(response, 404, wireError('NOT_FOUND', `unknown route ${request.method ?? 'UNKNOWN'} ${pathname}`));
    })().catch((error: unknown) => {
      if (error instanceof RequestError) {
        sendJson(response, error.status, wireError(error.code, error.message));
        return;
      }
      if (error instanceof MimicError) {
        sendJson(response, 400, wireError(error.code, error.message));
        return;
      }
      sendJson(response, 500, wireError('INTERNAL_ERROR', message(error)));
    });
  });

  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
        else resolve();
      });
    });
    return closePromise;
  };

  server.listen(port, host);
  return { server, store, close };
}
