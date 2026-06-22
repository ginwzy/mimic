/**
 * patch/screen —— 覆盖 jsdom 的 screen 尺寸 / 色深为 profile 值。
 */
export default {
  name: 'screen',
  after: [],
  apply({ window, profile, mask }) {
    const p = profile.section('screen');
    mask.mixin(window.screen, {
      width: () => p.width ?? 1920,
      height: () => p.height ?? 1080,
      availWidth: () => p.availWidth ?? p.width ?? 1920,
      availHeight: () => p.availHeight ?? p.height ?? 1040,
      colorDepth: () => p.colorDepth ?? 24,
      pixelDepth: () => p.pixelDepth ?? 24,
    });
  },
};
