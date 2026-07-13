import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ProfileRecord, ProfilesPort } from '../app/index.js';
import { MimicError } from '../core/error.js';
import { parsePage, parseProfile, parseShape } from '../core/parse.js';

export type ArtifactKind = 'profiles' | 'pages' | 'shapes';

export function artifactPath(root: string, kind: ArtifactKind, id: string): string {
  const name = `${Buffer.from(id, 'utf8').toString('base64url')}.json`;
  return path.join(path.resolve(root), kind, name);
}

async function json(file: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (cause) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `${label} 不可读取:${file}`, cause });
  }
}

export class ProfileFiles implements ProfilesPort {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async list(): Promise<string[]> {
    const directory = path.join(this.root, 'profiles');
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      const error = cause as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') return [];
      throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `Profile 目录不可读取:${directory}`, cause });
    }
    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue;
      ids.push(parseProfile(await json(path.join(directory, entry.name), 'Profile')).id);
    }
    return ids.sort();
  }

  async load(id: string): Promise<ProfileRecord> {
    if (typeof id !== 'string' || !id) {
      throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: 'Profile id 必须是非空字符串' });
    }
    const profile = parseProfile(await json(artifactPath(this.root, 'profiles', id), 'Profile'));
    if (profile.id !== id) {
      throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `Profile 文件 id 不匹配:${id}` });
    }
    const shape = parseShape(await json(artifactPath(this.root, 'shapes', profile.shape.id), 'Shape'));
    if (shape.hash !== profile.shape.hash) {
      throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `Profile Shape hash 不匹配:${id}` });
    }
    let page;
    try {
      page = parsePage(await json(artifactPath(this.root, 'pages', `${id}:default`), 'Page'));
    } catch (cause) {
      const nested = (cause as { cause?: NodeJS.ErrnoException }).cause;
      if (nested?.code !== 'ENOENT') throw cause;
    }
    return { profile, ...(page === undefined ? {} : { page }), shape };
  }
}
