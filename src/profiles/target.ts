import { MimicError } from '../core/error.js';
import type { Data, Form, Host, JsonValue, Platform, Target } from '../core/types.js';
import { isData, requireIdentity } from './browser.js';

function brands(navigator: Data): Data[] {
  const uaData = navigator.userAgentData;
  if (!isData(uaData) || !Array.isArray(uaData.brands)) return [];
  return uaData.brands.filter(isData);
}

export function inferTarget(data: { navigator?: Data; screen?: Data; window?: Data }): Target {
  requireIdentity(data);
  const navigator = data.navigator;
  const uaData = isData(navigator.userAgentData) ? navigator.userAgentData : undefined;
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  const windowData = data.window || {};
  const hasChromeEvidence = Object.prototype.hasOwnProperty.call(windowData, 'chrome');

  let host: Host;
  if (hasChromeEvidence) host = windowData.chrome == null ? 'webview' : 'chrome';
  else if (brands(navigator).some((brand) => String(brand.brand || '').includes('Android WebView'))) host = 'webview';
  else if (uaData && (Array.isArray(uaData.brands) || typeof uaData.platform === 'string' || typeof uaData.mobile === 'boolean')) host = 'chrome';
  else host = /\bwv\b/.test(ua) ? 'webview' : 'chrome';

  const platformLabel = typeof uaData?.platform === 'string' ? uaData.platform.toLowerCase() : '';
  let platform: Platform;
  if (platformLabel.includes('android') || /Android/.test(ua)) platform = 'android';
  else if (platformLabel.includes('mac') || /Macintosh/.test(ua)) platform = 'macos';
  else if (platformLabel.includes('win') || /Windows/.test(ua)) platform = 'windows';
  else if (platformLabel.includes('linux') || /Linux/.test(ua)) platform = 'linux';
  else throw new MimicError({ phase: 'parse', code: 'LEGACY_ENGINE', message: '无法从旧 Profile 推导平台' });

  const form: Form = typeof uaData?.mobile === 'boolean'
    ? (uaData.mobile ? 'mobile' : 'desktop')
    : (/Mobile/.test(ua) ? 'mobile' : 'desktop');

  const versions = [
    (ua.match(/Chrom(?:e|ium)\/(\d+)/) || [])[1],
    typeof uaData?.uaFullVersion === 'string' && uaData.uaFullVersion ? uaData.uaFullVersion.split('.')[0] : undefined,
    ...brands(navigator)
      .filter((brand) => /Google Chrome|Chromium|Android WebView/.test(String(brand.brand || '')))
      .map((brand) => String(brand.version || '').split('.')[0]),
  ].filter((value): value is string => Boolean(value));
  const uniqueVersions = new Set(versions);
  if (uniqueVersions.size > 1) {
    throw new MimicError({ phase: 'parse', code: 'LEGACY_TRAITS', message: `旧 Profile Chromium 版本证据冲突:${[...uniqueVersions].join(',')}` });
  }
  const version = Number.parseInt(versions[0] || '', 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new MimicError({ phase: 'parse', code: 'LEGACY_ENGINE', message: '无法从旧 Profile 推导 Chromium 版本' });
  }

  return { engine: 'chromium', host, platform, form, version };
}

export function validateTargetClaims(target: Target, claims: unknown): void {
  const traits = isData(claims) ? claims : {};
  const expected: Record<string, JsonValue> = {
    engine: target.engine,
    host: target.host,
    platform: target.platform,
    formFactor: target.form,
    version: target.version,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (traits[key] !== undefined && traits[key] !== value) {
      throw new MimicError({
        phase: 'parse',
        code: 'LEGACY_TRAITS',
        message: `旧 Profile traits.${key}=${String(traits[key])} 与证据推导值 ${String(value)} 冲突`,
      });
    }
  }
}
