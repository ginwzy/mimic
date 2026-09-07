import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProfileRecord, ProfilesPort } from '../src/app/types.js';
import { parsePage, parseProfile } from '../src/core/parse.js';
import { targetShape } from '../src/collect/identity.js';

const records = readFile(path.resolve('test/fixtures/identities.json'), 'utf8')
  .then((text) => JSON.parse(text) as Record<string, Omit<ProfileRecord, 'shape'>>);

// Frozen identity evidence for feature/oracle tests, never a runtime device source.
export class FixtureProfiles implements ProfilesPort {
  async list(): Promise<string[]> {
    return Object.keys(await records).sort();
  }

  async load(id: string): Promise<ProfileRecord> {
    const record = (await records)[id];
    if (!record) throw new Error(`Unknown test identity: ${id}`);
    const profile = parseProfile(record.profile);
    const shape = await targetShape(profile.target);
    return { profile, shape, ...(record.page ? { page: parsePage(record.page) } : {}) };
  }
}
