import type { Server } from 'node:http';

export interface LegacyResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  stack?: string;
  missing: string[];
}

export class Profile {
  constructor(data?: Record<string, unknown>);
  static load(source?: string | Record<string, unknown> | Profile): Promise<Profile>;
  static list(): Promise<string[]>;
  readonly data: Record<string, unknown>;
  readonly name: string;
  section(name: string): Record<string, unknown>;
  get(path: string, fallback?: unknown): unknown;
  traits(): Record<string, unknown>;
  validate(): string[];
}

export interface LegacyRealmOptions {
  profile?: string | Record<string, unknown> | Profile;
  trace?: boolean;
  patches?: readonly unknown[];
  url?: string;
  debug?: boolean;
}

export class Realm {
  static create(options?: LegacyRealmOptions): Promise<Realm>;
  run(code: string, options?: { url?: string; timeoutMs?: number }): LegacyResult;
  describe(): Record<string, unknown>;
  dispose(): void;
}

export class Session {
  static create(options?: LegacyRealmOptions): Promise<Session>;
  readonly captured: unknown;
  setCookies(cookies?: readonly string[]): void;
  driveEvents(): void;
  capture(code: string, options?: {
    scriptUrl?: string;
    maxPosts?: number;
    deadlineMs?: number;
    driveEvents?: boolean;
    pollMs?: number;
  }): Promise<unknown>;
  describe(): Record<string, unknown>;
  dispose(): void;
}

export interface LegacyPoolOptions {
  size?: number;
  timeoutMs?: number | null;
  maxQueue?: number;
}

export interface LegacyPoolJob {
  code: string;
  profile?: string;
  url?: string;
  scriptUrl?: string;
  trace?: boolean;
  timeoutMs?: number | null;
}

export class RealmPool {
  constructor(options?: LegacyPoolOptions);
  readonly size: number;
  readonly timeoutMs: number | undefined;
  readonly maxQueue: number;
  readonly pending: number;
  readonly queued: number;
  readonly active: number;
  readonly stats: { size: number; active: number; idle: number; queued: number; maxQueue: number };
  run(job: LegacyPoolJob): Promise<LegacyResult>;
  destroy(): Promise<void>;
}

export function createMask(window: object): Record<string, unknown>;
export const patches: readonly unknown[];
export function serializeResult(result: LegacyResult): LegacyResult;
export function startServer(options?: LegacyPoolOptions & { host?: string; port?: number }): {
  server: Server;
  pool: RealmPool;
  close(): Promise<void>;
};
