/**
 * 从采集数据派生 traits + 组装成 profile。
 * traits 是 UA 的投影,与 profile.validate() 对偶 —— 故新采集必过 validate
 * (那只证明自洽,不证明采集忠实)。它真正的价值在校验手编/合并的 profile。
 */

/** 从采集数据派生环境特征。 */
export function deriveTraits(data) {
  const ua = data.navigator?.userAgent || '';
  const traits = { engine: 'chromium' };
  traits.platform =
    /Android/.test(ua) ? 'android'
    : /Windows/.test(ua) ? 'windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macos'
    : /Linux|X11/.test(ua) ? 'linux'
    : 'unknown';
  traits.formFactor = /Mobile/.test(ua) ? 'mobile' : 'desktop';
  traits.host = /\bwv\b/.test(ua) ? 'webview' : 'chrome';
  const m = ua.match(/Chrom(?:e|ium)\/(\d+)/);
  if (m) traits.version = Number(m[1]);
  return traits;
}

/** 建议的 profile 名:platform-host[-mobile]-vNNN。 */
export function suggestName(traits) {
  const parts = [traits.platform, traits.host];
  if (traits.formFactor === 'mobile' && traits.host !== 'webview') parts.push('mobile');
  if (traits.version) parts.push(`v${traits.version}`);
  return parts.join('-');
}

/** 把采集数据组装为可落盘的 profile(写入 meta.traits/name)。 */
export function finalize(data, name) {
  const traits = deriveTraits(data);
  const meta = { ...(data.meta || {}), traits, name: name || suggestName(traits) };
  return { ...data, meta };
}
