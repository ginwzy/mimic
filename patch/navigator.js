/**
 * patch/navigator —— 把 jsdom 的 navigator 改造成 profile 指定的 Chrome navigator。
 * 在 jsdom 原生 Navigator 原型上以 getter 覆盖,保留原型链与 instanceof。
 */
export default {
  name: 'navigator',
  after: [],
  apply({ window, profile, mask, traits }) {
    const p = profile.section('navigator');
    const nav = window.navigator;
    const mobile = traits.formFactor === 'mobile';

    // 标量属性:以原型 getter 覆盖(mask.mixin 已处理描述符 + native 化)。
    mask.mixin(nav, {
      userAgent: () => p.userAgent ?? nav.userAgent,
      appVersion: () => p.appVersion ?? nav.appVersion,
      platform: () => p.platform ?? 'Win32',
      vendor: () => p.vendor ?? 'Google Inc.',
      language: () => p.language ?? 'en-US',
      languages: () => [...(p.languages ?? ['en-US', 'en'])],
      hardwareConcurrency: () => p.hardwareConcurrency ?? 8,
      deviceMemory: () => p.deviceMemory ?? 8,
      // 形态差异:移动端默认有触点,桌面为 0。
      maxTouchPoints: () => p.maxTouchPoints ?? (mobile ? 5 : 0),
      webdriver: () => false,
    });

    // connection: 伪造 NetworkInformation 内部接口(满足 instanceof + window 身份)。
    if (p.connection) {
      const { create } = mask.iface('NetworkInformation');
      const conn = create({ onchange: null, ...p.connection });
      mask.mixin(nav, { connection: () => conn });
    }
  },
};
