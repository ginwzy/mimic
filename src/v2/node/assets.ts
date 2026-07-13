import { fileURLToPath } from 'node:url';

export const DEFAULT_PROFILES_ROOT = fileURLToPath(new URL('../../../assets/profiles/', import.meta.url));
export const DEFAULT_SHAPES_ROOT = fileURLToPath(new URL('../../../assets/shapes/', import.meta.url));
export const DEFAULT_PROBE_PATH = fileURLToPath(new URL('../../../assets/probe.js', import.meta.url));
