import { MimicError } from '../core/error.js';
import type { Data, Part } from '../core/types.js';
import type { IdentityFacts, PageFacts } from './types.js';

/** Browser-section layout shared by capture evidence and the v1 input adapter. */
export type BrowserEvidence = Data & {
  meta?: Data;
  navigator?: Data;
  screen?: Data;
  window?: Data;
  timezone?: Data;
  webgl?: Data;
  audio?: Data;
  systemColors?: Data;
  canvas?: Data;
  location?: Data;
  timing?: Data;
};

export function isData(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function requireIdentity<T extends { navigator?: unknown; screen?: unknown }>(
  data: T,
): asserts data is T & { navigator: Data; screen: Data } {
  if (!isData(data.navigator) || !isData(data.screen)) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: '旧 Profile 缺少 navigator 或 screen' });
  }
}

export function capturedParts(fidelity: unknown): Part[] {
  if (!isData(fidelity)) return [];
  return (['navigator', 'screen', 'window', 'timezone', 'webgl', 'canvas', 'audio', 'fonts'] as Part[])
    .filter(part => fidelity[part] === 'real' || fidelity[part] === 'params');
}

export function browserFacts(data: BrowserEvidence): { identity: IdentityFacts; page?: PageFacts } {
  requireIdentity(data);
  const navigator = { ...data.navigator };
  const connection = navigator.connection;
  delete navigator.connection;
  const window = data.window ? { ...data.window } : undefined;
  if (window) delete window.chrome;
  const identity: IdentityFacts = {
    navigator, screen: data.screen,
    ...(window === undefined ? {} : { window }),
    ...(data.timezone === undefined ? {} : { timezone: data.timezone }),
    ...(data.webgl === undefined ? {} : { webgl: data.webgl }),
    ...(data.audio === undefined ? {} : { audio: data.audio }),
    ...(data.systemColors === undefined ? {} : { systemColors: data.systemColors }),
    ...(data.canvas === undefined ? {} : { canvas: data.canvas }),
  };
  const hasPage = data.location !== undefined || data.timing !== undefined || isData(connection);
  return {
    identity,
    ...(hasPage ? { page: {
      ...(typeof data.location?.href === 'string' ? { url: data.location.href } : {}),
      ...(isData(connection) ? { connection } : {}),
      ...(data.timing ? { clock: data.timing } : {}),
    } } : {}),
  };
}
