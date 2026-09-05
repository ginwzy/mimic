import { MimicError } from '../core/error.js';
import { digest } from '../core/seal.js';
import type { Hash, JsonValue } from '../core/types.js';
import { isData, type BrowserEvidence } from './browser.js';
import type { LedgerEntry, NormalizationReport } from './types.js';

function mapped(pathName: string): LedgerEntry {
  if (pathName === 'navigator.connection' || pathName.startsWith('navigator.connection.')) {
    return { status: 'mapped', target: pathName.replace('navigator.connection', 'page.connection') };
  }
  if (pathName === 'location' || pathName === 'location.href') {
    return { status: 'mapped', target: pathName.replace('location.href', 'page.url').replace('location', 'page') };
  }
  if (pathName === 'timing' || pathName === 'timing.now' || pathName === 'timing.seed') {
    return { status: 'mapped', target: pathName.replace('timing', 'page.clock') };
  }
  if (pathName === 'window.chrome' || pathName.startsWith('window.chrome.')) {
    return { status: 'consumed', target: 'shape.host' };
  }
  if (pathName === 'meta' || pathName.startsWith('meta.')) return { status: 'consumed' };
  if (pathName === 'navigator') return { status: 'mapped', target: 'profile.navigator' };
  const nav = new Set(['userAgent', 'appVersion', 'platform', 'vendor', 'language', 'languages', 'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints', 'cookieEnabled']);
  if (pathName.startsWith('navigator.') && nav.has(pathName.slice('navigator.'.length))) return { status: 'mapped', target: `profile.${pathName}` };
  const ua = new Set(['brands', 'mobile', 'platform', 'architecture', 'bitness', 'fullVersionList', 'model', 'platformVersion', 'uaFullVersion', 'wow64']);
  if (pathName === 'navigator.userAgentData' || (pathName.startsWith('navigator.userAgentData.') && ua.has(pathName.slice('navigator.userAgentData.'.length)))) {
    return { status: 'mapped', target: `profile.${pathName}` };
  }
  if (pathName === 'screen') return { status: 'mapped', target: 'profile.screen' };
  const screen = new Set(['width', 'height', 'availWidth', 'availHeight', 'availLeft', 'availTop', 'colorDepth', 'pixelDepth', 'orientation', 'orientation.type', 'orientation.angle']);
  if (pathName.startsWith('screen.') && screen.has(pathName.slice('screen.'.length))) return { status: 'mapped', target: `profile.${pathName}` };
  if (pathName === 'window') return { status: 'mapped', target: 'profile.window' };
  const windowKeys = new Set(['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio']);
  if (pathName.startsWith('window.') && windowKeys.has(pathName.slice('window.'.length))) return { status: 'mapped', target: `profile.${pathName}` };
  if (pathName === 'timezone' || pathName === 'timezone.timeZone' || pathName === 'timezone.offset') return { status: 'mapped', target: `profile.${pathName}` };
  if (pathName === 'webgl' || pathName === 'webgl.parameters' || pathName.startsWith('webgl.parameters.')
    || pathName === 'webgl.extensions' || pathName === 'webgl.unmaskedVendor' || pathName === 'webgl.unmaskedRenderer'
    || pathName === 'webgl.shaderPrecision' || pathName.startsWith('webgl.shaderPrecision.')) {
    return { status: 'mapped', target: `profile.${pathName}` };
  }
  return { status: 'raw-preserved' };
}

export function ledgerOf(data: BrowserEvidence, origins: Record<string, { id: string; hash: Hash }>): Record<string, LedgerEntry> {
  const ledger: Record<string, LedgerEntry> = {};
  const visit = (value: JsonValue, prefix: string) => {
    if (prefix) ledger[prefix] = { ...mapped(prefix), ...(origins[prefix] ? { source: origins[prefix] } : {}) };
    if (!isData(value)) return;
    for (const [key, child] of Object.entries(value)) visit(child, prefix ? `${prefix}.${key}` : key);
  };
  visit(data, '');
  return ledger;
}

export function originsOf(data: BrowserEvidence, id: string, hash: Hash): Record<string, { id: string; hash: Hash }> {
  const output: Record<string, { id: string; hash: Hash }> = {};
  const visit = (value: JsonValue, prefix: string): void => {
    if (prefix) output[prefix] = { id, hash };
    if (!isData(value)) return;
    for (const [key, child] of Object.entries(value)) visit(child, prefix ? `${prefix}.${key}` : key);
  };
  visit(data, '');
  return output;
}

export function warningsOf(data: BrowserEvidence, ledger: Record<string, LedgerEntry>): string[] {
  const warnings: string[] = [];
  const hygiene = isData(data.meta?.hygiene) ? data.meta.hygiene : undefined;
  if (Array.isArray(hygiene?.issues)) warnings.push(...hygiene.issues.filter((issue): issue is string => typeof issue === 'string'));
  const windowData = data.window;
  if (windowData && ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight'].some((key) => windowData[key] === 0)) {
    warnings.push('window geometry contains zero');
  }
  const preserved = Object.entries(ledger).filter(([, entry]) => entry.status === 'raw-preserved').map(([key]) => key);
  if (preserved.length) warnings.push(`unmapped legacy paths:${preserved.join(',')}`);
  return warnings;
}

/** Preserve the v2 migration ledger independently of Profile normalization. */
export function createReport(id: string, fields: BrowserEvidence, derived: string[]): NormalizationReport {
  const ledger = ledgerOf(fields, originsOf(fields, id, digest(fields)));
  const unmapped = Object.entries(ledger).filter(([, entry]) => entry.status === 'raw-preserved').map(([name]) => name);
  if (unmapped.length) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `旧 Profile 含未映射字段:${unmapped.join(',')}` });
  }
  return {
    id,
    chain: [id],
    meta: structuredClone(fields.meta || {}),
    ledger,
    warnings: warningsOf(fields, ledger),
    derived,
  };
}

