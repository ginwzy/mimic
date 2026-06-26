/**
 * patch/screen —— 覆盖 jsdom 的 screen 尺寸 / 色深为 profile 值,并补真机 Screen.prototype 标准扩展键。
 *
 * Screen.prototype 真机[实测]含 availLeft / availTop / orientation(jsdom 缺,旧为覆盖缺口)。三者皆为
 * 原型上的只读 accessor(同 width/height,经 mask.mixin 装在原型)。orientation 返回 ScreenOrientation
 * 单例:继承 EventTarget、type/angle 自 profile.screen.orientation、onchange 可写。
 *
 * 边界:Screen.prototype 真机还有 onchange / isExtended 两键 + own 键序(constructor 在末位),属另两轴
 * (事件处理器 / 键序),本补丁不动 —— 故 Screen.prototype own 键集仍与真机不等,不触发 ownKeys.order 比较。
 */
export default {
  name: 'screen',
  after: [],
  apply({ window, profile, mask }) {
    const p = profile.section('screen');
    const o = p.orientation || {};

    // ScreenOrientation 单例(对照 navigator.connection 的 NetworkInformation 建法):继承 EventTarget,
    // type/angle 为原型只读 accessor(读 profile),onchange 可写 accessor(get-only 会令 strict 赋值抛),
    // lock/unlock 为方法壳。eager create → getter 恒返同一实例(=== 不变量)。
    const so = mask.iface('ScreenOrientation');
    Object.setPrototypeOf(so.proto, window.EventTarget.prototype); // 真机:ScreenOrientation extends EventTarget
    mask.accessors(so.proto, {
      type: () => o.type || 'landscape-primary',
      angle: () => o.angle ?? 0,
    });
    let onchange = null;
    Object.defineProperty(so.proto, 'onchange', {
      get: mask.native(() => onchange, 'get onchange', 0),
      set: mask.native((v) => { onchange = v; }, 'set onchange', 1),
      enumerable: true, configurable: true,
    });
    mask.methods(so.proto, { lock: [1, () => mask.adopt(window.Promise.resolve())], unlock: [0, () => undefined] });
    const orientation = so.create();

    mask.mixin(window.screen, {
      width: () => p.width ?? 1920,
      height: () => p.height ?? 1080,
      availWidth: () => p.availWidth ?? p.width ?? 1920,
      availHeight: () => p.availHeight ?? p.height ?? 1040,
      colorDepth: () => p.colorDepth ?? 24,
      pixelDepth: () => p.pixelDepth ?? 24,
      availLeft: () => p.availLeft ?? 0,
      availTop: () => p.availTop ?? 0,
      orientation: () => orientation,
    });
  },
};
