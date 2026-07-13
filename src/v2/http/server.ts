import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createNodeApplication } from '../node/app.js';
import type { TaskRequest } from '../app/index.js';
import { QueueFullError, WorkerExecutor, type ExecutorOptions } from '../executor/pool.js';

export const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface ServerOptions extends ExecutorOptions {
  readonly port?: number;
  readonly host?: string;
  readonly maxBodyBytes?: number;
}

export interface ServerHandle {
  readonly server: http.Server;
  readonly executor: WorkerExecutor;
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

const taskRoutes = new Map<string, TaskRequest['job']['kind']>([
  ['/run', 'run'],
  ['/capture', 'capture'],
  ['/probe', 'probe'],
  ['/diagnose', 'diagnose'],
]);

function integer(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
}

function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = request.headers['content-length'];
    if (declared !== undefined) {
      const length = Number(declared);
      if (!Number.isSafeInteger(length) || length < 0) {
        request.resume();
        reject(new RequestError(400, 'BAD_CONTENT_LENGTH', 'content-length must be a non-negative integer'));
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
      try {
        resolve(text ? JSON.parse(text) as unknown : {});
      } catch {
        reject(new RequestError(400, 'BAD_JSON', 'request body must be valid JSON'));
      }
    });
    request.on('aborted', () => fail(new RequestError(400, 'REQUEST_ABORTED', 'request body was aborted')));
    request.on('error', (error) => fail(error));
  });
}

function taskRequest(input: unknown): TaskRequest {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new RequestError(400, 'BAD_REQUEST', 'request body must be an object');
  }
  const value = input as { readonly profile?: unknown; readonly job?: unknown };
  if (typeof value.profile !== 'string' || !value.profile) {
    throw new RequestError(400, 'BAD_REQUEST', 'profile must be a non-empty string');
  }
  if (value.job === null || typeof value.job !== 'object' || Array.isArray(value.job)) {
    throw new RequestError(400, 'BAD_REQUEST', 'job must be an object');
  }
  return input as TaskRequest;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function wireError(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function startServer(options: ServerOptions): ServerHandle {
  const {
    port = 3000,
    host = '127.0.0.1',
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    ...executorOptions
  } = options;
  if (typeof host !== 'string' || !host.trim()) throw new TypeError('host must be a non-empty string');
  integer(port, 'port', 0, 65_535);
  integer(maxBodyBytes, 'maxBodyBytes', 1, Number.MAX_SAFE_INTEGER);

  const executor = new WorkerExecutor(executorOptions);
  const application = createNodeApplication({
    ...(executorOptions.profilesRoot === undefined ? {} : { profilesRoot: executorOptions.profilesRoot }),
    ...(executorOptions.shapesRoot === undefined ? {} : { shapesRoot: executorOptions.shapesRoot }),
    ...(executorOptions.probePath === undefined ? {} : { probePath: executorOptions.probePath }),
    ...(executorOptions.capture === undefined ? {} : { capture: executorOptions.capture }),
  });

  const server = http.createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (request.method === 'GET' && pathname === '/profiles') {
        send(response, 200, await application.list('profiles'));
        return;
      }

      const expected = request.method === 'POST' ? taskRoutes.get(pathname) : undefined;
      if (expected === undefined) {
        send(response, 404, wireError('NOT_FOUND', `unknown route ${request.method ?? 'UNKNOWN'} ${pathname}`));
        return;
      }

      const input = taskRequest(await readJson(request, maxBodyBytes));
      if (input.job.kind !== expected) {
        throw new RequestError(400, 'BAD_ROUTE_KIND', `${pathname} requires a ${expected} job`);
      }
      send(response, 200, await executor.run(input));
    })().catch((error: unknown) => {
      if (error instanceof RequestError) {
        send(response, error.status, wireError(error.code, error.message));
        return;
      }
      if (error instanceof QueueFullError) {
        send(response, 503, wireError(error.code, error.message));
        return;
      }
      send(response, 400, wireError('BAD_REQUEST', errorMessage(error)));
    });
  });

  let destroyPromise: Promise<void> | undefined;
  const destroy = (): Promise<void> => {
    destroyPromise ??= executor.destroy();
    return destroyPromise;
  };
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      try {
        if (server.listening) {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
          });
        }
      } finally {
        await destroy();
      }
    })();
    return closePromise;
  };

  server.once('error', () => {
    void destroy();
  });
  try {
    server.listen(port, host);
  } catch (error) {
    void destroy();
    throw error;
  }
  return { server, executor, close };
}
