#!/usr/bin/env node
import { once } from 'node:events';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_COLLECT_MAX_BODY_BYTES,
  DEFAULT_COLLECT_PORT,
  startCollectServer,
} from './collect/server.js';
import { startServer, type ServerHandle } from './http/server.js';
import { encodeResult } from './core/result.js';
import type { JsonValue } from './core/types.js';
import { DEFAULT_TIMEOUT_MS } from './executor/pool.js';
import { createMimic } from './sdk.js';
import { DEFAULT_PROBE_PATH, DEFAULT_PROFILES_ROOT } from './node/assets.js';
import { diff, summarize, type ProbeSnapshot } from './probe/diff.js';

export type CliServerHandle = Pick<ServerHandle, 'server' | 'close'>;

export interface CliIo {
  readonly cwd: string;
  stdout(text: string): void;
  stderr(text: string): void;
  started?(handle: CliServerHandle): void;
}

type FlagValue = string | true;

interface Arguments {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, FlagValue>>;
}

const defaultIo: CliIo = {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
};

const knownFlags = new Set([
  'profile',
  'profiles',
  'probe',
  'pool-size',
  'timeout',
  'max-queue',
  'capture-deadline',
  'capture-poll',
  'capture-max-posts',
  'script-url',
  'trace',
  'port',
  'host',
  'max-body',
  'root',
  'baseline',
  't1',
]);

function parseArguments(argv: readonly string[]): Arguments {
  const [command, ...tail] = argv;
  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];
  for (let index = 0; index < tail.length; index++) {
    const argument = tail[index];
    if (argument === undefined) continue;
    if (!argument.startsWith('--')) {
      positionals.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (!knownFlags.has(name)) throw new TypeError(`unknown flag --${name}`);
    const next = tail[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      index++;
    } else {
      flags[name] = true;
    }
  }
  return { command, positionals, flags };
}

function stringFlag(flags: Arguments['flags'], name: string, fallback?: string): string | undefined {
  const value = flags[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`--${name} requires a value`);
  return value;
}

function integerFlag(
  flags: Arguments['flags'],
  name: string,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const value = flags[name];
  if (value === undefined) return fallback;
  if (value === true) throw new TypeError(`--${name} requires an integer`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`--${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function booleanFlag(flags: Arguments['flags'], name: string): boolean | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === 'false') return false;
  throw new TypeError(`--${name} must be true or false`);
}

function absolute(cwd: string, value: string): string {
  return path.resolve(cwd, value);
}

function pathFlag(args: Arguments, io: CliIo, name: string, fallback: string): string {
  const value = stringFlag(args.flags, name);
  return value === undefined ? fallback : absolute(io.cwd, value);
}

function output(io: CliIo, value: unknown): void {
  io.stdout(JSON.stringify(value));
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function failure(io: CliIo, error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  io.stderr(JSON.stringify({ ok: false, error: { code: 'CLI_ERROR', message } }));
  return 1;
}

function sharedOptions(args: Arguments, io: CliIo) {
  const size = integerFlag(args.flags, 'pool-size', 1, 1);
  const timeoutMs = integerFlag(args.flags, 'timeout', DEFAULT_TIMEOUT_MS, 1);
  return {
    profile: stringFlag(args.flags, 'profile', 'chrome-mac') as string,
    profilesRoot: pathFlag(args, io, 'profiles', DEFAULT_PROFILES_ROOT),
    probePath: pathFlag(args, io, 'probe', DEFAULT_PROBE_PATH),
    size,
    timeoutMs,
    maxQueue: integerFlag(args.flags, 'max-queue', size, 0),
    capture: {
      deadlineMs: integerFlag(args.flags, 'capture-deadline', 1_000, 1),
      pollMs: integerFlag(args.flags, 'capture-poll', 10, 1),
      maxPosts: integerFlag(args.flags, 'capture-max-posts', 1, 1),
    },
  };
}

async function script(args: Arguments, io: CliIo): Promise<string> {
  const file = args.positionals[0];
  if (file === undefined) throw new TypeError(`${args.command ?? 'command'} requires a script file`);
  if (args.positionals.length > 1) throw new TypeError(`${args.command ?? 'command'} accepts one script file`);
  return fs.readFile(absolute(io.cwd, file), 'utf8');
}

function scriptOptions(args: Arguments): { readonly scriptUrl?: string; readonly trace?: boolean } {
  const scriptUrl = stringFlag(args.flags, 'script-url');
  const trace = booleanFlag(args.flags, 'trace');
  return {
    ...(scriptUrl === undefined ? {} : { scriptUrl }),
    ...(trace === undefined ? {} : { trace }),
  };
}

async function sdkCommand(args: Arguments, io: CliIo): Promise<number> {
  if (!['run', 'capture', 'diagnose', 'probe', 'plan', 'list'].includes(args.command ?? '')) {
    throw new TypeError('command must be run, capture, probe, diagnose, diff, plan, list, collect, or serve');
  }
  const code = ['run', 'capture', 'diagnose', 'plan'].includes(args.command ?? '')
    ? await script(args, io)
    : undefined;
  if (args.command === 'probe' && args.positionals.length) {
    throw new TypeError('probe does not accept a script file');
  }
  const listKind = args.command === 'list' ? args.positionals[0] ?? 'profiles' : undefined;
  if (args.command === 'list'
    && (args.positionals.length > 1 || !['profiles', 'shapes', 'features', 'drivers'].includes(listKind ?? ''))) {
    throw new TypeError('list kind must be profiles, shapes, features, or drivers');
  }

  const mimic = createMimic(sharedOptions(args, io));
  try {
    let value: unknown;
    switch (args.command) {
      case 'run': {
        value = await mimic.run({ kind: 'run', code: code!, ...scriptOptions(args) });
        break;
      }
      case 'capture': {
        value = await mimic.capture({ kind: 'capture', code: code!, ...scriptOptions(args) });
        break;
      }
      case 'diagnose': {
        value = await mimic.diagnose({ kind: 'diagnose', code: code!, ...scriptOptions(args) });
        break;
      }
      case 'probe': {
        value = await mimic.probe({ kind: 'probe' });
        break;
      }
      case 'plan': {
        value = await mimic.plan({ kind: 'run', code: code!, ...scriptOptions(args) });
        break;
      }
      case 'list': {
        value = await mimic.list(listKind as 'profiles' | 'shapes' | 'features' | 'drivers');
        break;
      }
    }
    output(io, value);
    return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false ? 1 : 0;
  } finally {
    await mimic.close();
  }
}

const pairedBaselines: Readonly<Record<string, string>> = {
  'chrome-mac': 'macos-chrome-v148',
};

function baselineRoot(probePath: string): string {
  return path.join(path.dirname(probePath), 'baselines');
}

async function baselineFile(args: Arguments, io: CliIo, profile: string, probePath: string): Promise<string> {
  const reference = stringFlag(args.flags, 'baseline');
  if (reference !== undefined) {
    if (reference.endsWith('.json') || path.isAbsolute(reference) || /[\\/]/.test(reference)) {
      return absolute(io.cwd, reference);
    }
    return path.join(baselineRoot(probePath), `${reference}.json`);
  }

  const root = baselineRoot(probePath);
  let names: string[];
  try {
    names = (await fs.readdir(root))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .sort();
  } catch {
    throw new TypeError('diff requires --baseline <snapshot.json>');
  }
  const paired = pairedBaselines[profile];
  if (paired !== undefined) return path.join(root, `${paired}.json`);
  if (names.includes(profile)) return path.join(root, `${profile}.json`);
  const prefixed = names.filter((name) => name.startsWith(`${profile}-`));
  if (prefixed.length === 1) return path.join(root, `${prefixed[0]}.json`);
  if (prefixed.length > 1) {
    throw new TypeError(`profile ${profile} has multiple baselines; use --baseline <snapshot.json>`);
  }
  throw new TypeError(`profile ${profile} has no baseline; use --baseline <snapshot.json>`);
}

function snapshot(value: unknown, label: string): ProbeSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a Probe snapshot object`);
  }
  const targets = (value as { targets?: unknown }).targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new TypeError(`${label} must contain at least one Probe target`);
  }
  const ids = new Set<string>();
  for (const target of targets) {
    if (target === null || typeof target !== 'object' || Array.isArray(target)) {
      throw new TypeError(`${label} contains an invalid Probe target`);
    }
    const { id, category } = target as { id?: unknown; category?: unknown };
    if (typeof id !== 'string' || !id || (category !== 'function' && category !== 'object')) {
      throw new TypeError(`${label} contains an invalid Probe target`);
    }
    if (ids.has(id)) throw new TypeError(`${label} contains duplicate Probe target ${id}`);
    ids.add(id);
  }
  return value as ProbeSnapshot;
}

async function diffCommand(args: Arguments, io: CliIo): Promise<number> {
  if (args.positionals.length > 1) throw new TypeError('diff accepts at most one profile');
  const shared = sharedOptions(args, io);
  const profile = args.positionals[0] ?? shared.profile;
  const file = await baselineFile(args, io, profile, shared.probePath);
  const baseline = snapshot(JSON.parse(await fs.readFile(file, 'utf8')) as unknown, 'baseline');
  const mimic = createMimic({ ...shared, profile });
  try {
    const probed = await mimic.probe({ kind: 'probe' });
    if (!probed.ok) {
      output(io, probed);
      return 1;
    }
    const actual = snapshot(probed.value, 'probe result');
    const entries = diff(baseline, actual);
    const summary = summarize(entries, { t1Only: booleanFlag(args.flags, 't1') ?? false });
    const result = encodeResult({
      ok: true,
      value: jsonValue({
        profile,
        baseline: path.relative(io.cwd, file) || path.basename(file),
        summary,
        entries,
      }),
      plan: probed.plan,
      support: probed.support,
      ...(probed.synthetic === true ? { synthetic: true as const } : {}),
    });
    output(io, result);
    return result.ok && summary.gatePass ? 0 : 1;
  } finally {
    await mimic.close();
  }
}

async function serve(args: Arguments, io: CliIo): Promise<number> {
  if (args.positionals.length) throw new TypeError('serve does not accept positional arguments');
  const shared = sharedOptions(args, io);
  const host = stringFlag(args.flags, 'host', '127.0.0.1') as string;
  const handle = startServer({
    profilesRoot: shared.profilesRoot,
    probePath: shared.probePath,
    size: shared.size,
    timeoutMs: shared.timeoutMs,
    maxQueue: shared.maxQueue,
    capture: shared.capture,
    host,
    port: integerFlag(args.flags, 'port', 3000, 0, 65_535),
    maxBodyBytes: integerFlag(args.flags, 'max-body', 4 * 1024 * 1024, 1),
  });
  try {
    await once(handle.server, 'listening');
  } catch (error) {
    await handle.close();
    throw error;
  }
  const address = handle.server.address();
  const port = typeof address === 'object' && address ? address.port : 3000;
  output(io, { ok: true, url: `http://${host}:${port}`, executor: handle.executor.stats });
  io.started?.(handle);
  installSignals(handle);
  return 0;
}

async function collect(args: Arguments, io: CliIo): Promise<number> {
  if (args.positionals.length) throw new TypeError('collect does not accept positional arguments');
  const host = stringFlag(args.flags, 'host', '0.0.0.0') as string;
  const root = absolute(io.cwd, stringFlag(args.flags, 'root', 'mimic-data') as string);
  const handle = startCollectServer({
    root,
    probePath: pathFlag(args, io, 'probe', DEFAULT_PROBE_PATH),
    host,
    port: integerFlag(args.flags, 'port', DEFAULT_COLLECT_PORT, 0, 65_535),
    maxBodyBytes: integerFlag(args.flags, 'max-body', DEFAULT_COLLECT_MAX_BODY_BYTES, 1),
  });
  try {
    await once(handle.server, 'listening');
  } catch (error) {
    await handle.close();
    throw error;
  }
  const address = handle.server.address();
  const port = typeof address === 'object' && address ? address.port : DEFAULT_COLLECT_PORT;
  output(io, { ok: true, url: `http://${host}:${port}`, root });
  io.started?.(handle);
  installSignals(handle);
  return 0;
}

function installSignals(handle: CliServerHandle): void {
  const stop = (): void => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    void handle.close().catch((error: unknown) => {
      process.exitCode = 1;
      defaultIo.stderr(JSON.stringify({
        ok: false,
        error: { code: 'CLI_CLOSE_ERROR', message: error instanceof Error ? error.message : String(error) },
      }));
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  handle.server.once('close', () => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  });
}

export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  try {
    const args = parseArguments(argv);
    if (args.command === 'serve') return await serve(args, io);
    if (args.command === 'collect') return await collect(args, io);
    if (args.command === 'diff') return await diffCommand(args, io);
    return await sdkCommand(args, io);
  } catch (error) {
    return failure(io, error);
  }
}

const entry = process.argv[1];
let direct = false;
if (entry !== undefined) {
  try {
    direct = realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    // Importers such as `node -` do not have a filesystem-backed argv[1].
  }
}
if (direct) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
