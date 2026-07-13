import type { Page, Profile, Shape } from './types.js';

const SHAPES = new WeakSet<object>();
const PROFILES = new WeakSet<object>();
const PAGES = new WeakSet<object>();

export function trustShape<T extends Shape>(shape: T): T {
  SHAPES.add(shape);
  return shape;
}

export function isTrustedShape(input: unknown): input is Shape {
  return input !== null && typeof input === 'object' && SHAPES.has(input);
}

export function trustProfile<T extends Profile>(profile: T): T {
  PROFILES.add(profile);
  return profile;
}

export function isTrustedProfile(input: unknown): input is Profile {
  return input !== null && typeof input === 'object' && PROFILES.has(input);
}

export function trustPage<T extends Page>(page: T): T {
  PAGES.add(page);
  return page;
}

export function isTrustedPage(input: unknown): input is Page {
  return input !== null && typeof input === 'object' && PAGES.has(input);
}
