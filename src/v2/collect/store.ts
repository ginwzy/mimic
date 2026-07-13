import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CatalogFiles } from '../catalog/files.js';
import { canonical } from '../core/canonical.js';
import { MimicError } from '../core/error.js';
import { jsonCopy } from '../core/json.js';
import { parseCollect } from '../core/parse.js';
import type { CatalogDoc, Page, Profile, Shape } from '../core/types.js';
import { artifactPath } from '../profile/files.js';
import { migrateCollect } from './contract.js';
import { normalizeCollect, type NormalizedCollect } from './normalize.js';
import type { CollectBundle } from './types.js';

const ROOT_WRITES = new Map<string, Promise<void>>();

async function rootWrite<T>(root: string, task: () => Promise<T>): Promise<T> {
  const previous = ROOT_WRITES.get(root) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  ROOT_WRITES.set(root, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (ROOT_WRITES.get(root) === tail) ROOT_WRITES.delete(root);
  }
}

export interface CollectFiles {
  readonly capture: string;
  readonly profile?: string;
  readonly page?: string;
  readonly shape?: string;
  readonly catalog?: string;
}

export interface CollectReceipt {
  readonly capture: CollectBundle;
  readonly artifacts?: NormalizedCollect;
  readonly catalog?: CatalogDoc;
  readonly files: CollectFiles;
}

function wire(value: unknown): string {
  return `${canonical(jsonCopy(value))}\n`;
}

function conflict(code: 'BAD_PROFILE' | 'BAD_PAGE' | 'BAD_SHAPE', label: string): MimicError {
  return new MimicError({ phase: 'parse', code, message: `${label} 与已有派生物冲突` });
}

async function exclusive(file: string, value: unknown, code: 'BAD_PROFILE' | 'BAD_PAGE' | 'BAD_SHAPE'): Promise<void> {
  const body = wire(value);
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(file, body, { flag: 'wx' });
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException;
    if (error.code !== 'EEXIST') throw cause;
    if (await readFile(file, 'utf8') !== body) throw conflict(code, path.basename(file));
  }
}

async function atomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, wire(value), { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function rawFile(root: string, bundle: CollectBundle): Promise<string> {
  const file = path.join(root, 'captures', `${bundle.hash}.json`);
  const body = wire(bundle);
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(file, body, { flag: 'wx' });
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException;
    if (error.code !== 'EEXIST') throw cause;
    const existing = parseCollect(JSON.parse(await readFile(file, 'utf8')) as unknown);
    if (existing.hash !== bundle.hash || wire(existing) !== body) {
      throw new MimicError({ phase: 'parse', code: 'BAD_COLLECT', message: `Capture hash 文件冲突:${bundle.hash}` });
    }
  }
  return file;
}

function files(root: string, bundle: CollectBundle, artifacts?: NormalizedCollect): CollectFiles {
  return {
    capture: path.join(root, 'captures', `${bundle.hash}.json`),
    ...(artifacts === undefined ? {} : {
      profile: artifactPath(root, 'profiles', artifacts.profile.id),
      ...(artifacts.page === undefined ? {} : { page: artifactPath(root, 'pages', artifacts.page.id) }),
      shape: artifactPath(root, 'shapes', artifacts.shape.id),
      catalog: path.join(root, 'catalog.json'),
    }),
  };
}

function unique<T extends { id: string; hash: string }>(items: readonly T[], code: 'BAD_PROFILE' | 'BAD_PAGE' | 'BAD_SHAPE'): T[] {
  const values = new Map<string, T>();
  for (const item of items) {
    const previous = values.get(item.id);
    if (previous && previous.hash !== item.hash) throw conflict(code, item.id);
    values.set(item.id, item);
  }
  return [...values.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export class CollectStore {
  readonly root: string;

  constructor(root: string) {
    if (typeof root !== 'string' || !root || root.includes('\0')) throw new TypeError('Collect root 必须是有效路径');
    this.root = path.resolve(root);
  }

  async append(input: unknown): Promise<CollectReceipt> {
    const capture = migrateCollect(input);
    const captureFile = await rawFile(this.root, capture);
    if (capture.profileRaw === null || capture.probeSnapshot === null) {
      return { capture, files: { capture: captureFile } };
    }
    return rootWrite(this.root, () => this.appendDerived(capture, captureFile));
  }

  private async appendDerived(capture: CollectBundle, captureFile: string): Promise<CollectReceipt> {
    const artifacts = normalizeCollect(capture);
    const shapeFile = artifactPath(this.root, 'shapes', artifacts.shape.id);
    try {
      const existing = JSON.parse(await readFile(shapeFile, 'utf8')) as Shape;
      if (existing.hash !== artifacts.shape.hash) throw conflict('BAD_SHAPE', artifacts.shape.id);
    } catch (cause) {
      const error = cause as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') throw cause;
    }

    const shapes = await this.shapes();
    const catalog = CatalogFiles.rebuild(unique([...shapes, artifacts.shape], 'BAD_SHAPE'), 'captured').data;
    const output = files(this.root, capture, artifacts);
    await exclusive(output.shape!, artifacts.shape, 'BAD_SHAPE');
    await exclusive(output.profile!, artifacts.profile, 'BAD_PROFILE');
    if (artifacts.page) await exclusive(output.page!, artifacts.page, 'BAD_PAGE');
    await atomic(output.catalog!, catalog);
    return { capture, artifacts, catalog, files: output };
  }

  async rebuild(): Promise<NormalizedCollect[]> {
    return rootWrite(this.root, () => this.rebuildDerived());
  }

  private async rebuildDerived(): Promise<NormalizedCollect[]> {
    const captures = await this.captures();
    const artifacts = captures
      .filter((capture) => capture.profileRaw !== null && capture.probeSnapshot !== null)
      .map((capture) => normalizeCollect(capture));
    const profiles = unique(artifacts.map(({ profile }) => profile), 'BAD_PROFILE');
    const pages = unique(artifacts.flatMap(({ page }) => page ? [page] : []), 'BAD_PAGE');
    const shapes = unique(artifacts.map(({ shape }) => shape), 'BAD_SHAPE');

    await Promise.all([
      rm(path.join(this.root, 'profiles'), { recursive: true, force: true }),
      rm(path.join(this.root, 'pages'), { recursive: true, force: true }),
      rm(path.join(this.root, 'shapes'), { recursive: true, force: true }),
      rm(path.join(this.root, 'catalog.json'), { force: true }),
    ]);
    for (const shape of shapes) await exclusive(artifactPath(this.root, 'shapes', shape.id), shape, 'BAD_SHAPE');
    for (const profile of profiles) await exclusive(artifactPath(this.root, 'profiles', profile.id), profile, 'BAD_PROFILE');
    for (const page of pages) await exclusive(artifactPath(this.root, 'pages', page.id), page, 'BAD_PAGE');
    await atomic(path.join(this.root, 'catalog.json'), CatalogFiles.rebuild(shapes, 'captured').data);
    return artifacts;
  }

  private async captures(): Promise<CollectBundle[]> {
    const directory = path.join(this.root, 'captures');
    let names: string[];
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
    } catch (cause) {
      const error = cause as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') return [];
      throw cause;
    }
    const output: CollectBundle[] = [];
    for (const name of names) output.push(parseCollect(JSON.parse(await readFile(path.join(directory, name), 'utf8')) as unknown));
    return output;
  }

  private async shapes(): Promise<Shape[]> {
    const directory = path.join(this.root, 'shapes');
    try {
      const catalog = await CatalogFiles.load(directory);
      return [...catalog.list()];
    } catch (cause) {
      const nested = (cause as { cause?: NodeJS.ErrnoException }).cause;
      if (nested?.code === 'ENOENT') return [];
      throw cause;
    }
  }
}
