/**
 * 纯浏览器端采集 —— 零依赖,可在任意 JS 环境运行(devtools console / 页面 / Android WebView)。
 * 暴露 window.__capture__():Promise<rawProfile>。
 *
 * 只采"标量/查表"类字段(设备报告的固定值,与检测器无关):
 *   navigator.* · userAgentData · screen · window(含 window.chrome 存在性) · timezone · WebGL getParameter 表
 * 渲染派生类(canvas/audio/fonts)不采为单值 —— 标 fidelity:absent,
 * 因为它们是 (操作输入 → GPU/驱动) 的函数,只有键到检测器实际 payload 才可回放。
 */
(function () {
  'use strict';

  const toArr = (v) => (v && typeof v !== 'string' && typeof v.length === 'number' ? Array.from(v) : v);

  function captureWebGL() {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    if (!gl) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const KEYS = [
      'VERSION', 'SHADING_LANGUAGE_VERSION', 'VENDOR', 'RENDERER',
      'MAX_TEXTURE_SIZE', 'MAX_VIEWPORT_DIMS', 'MAX_RENDERBUFFER_SIZE',
      'MAX_VERTEX_ATTRIBS', 'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS',
      'MAX_VARYING_VECTORS', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_TEXTURE_IMAGE_UNITS',
      'MAX_CUBE_MAP_TEXTURE_SIZE', 'ALIASED_LINE_WIDTH_RANGE', 'ALIASED_POINT_SIZE_RANGE',
    ];
    const parameters = {};
    for (const k of KEYS) {
      try { if (gl[k] !== undefined) parameters[gl[k]] = toArr(gl.getParameter(gl[k])); } catch { /* skip */ }
    }
    const out = { parameters, extensions: gl.getSupportedExtensions() };
    if (dbg) {
      try {
        out.unmaskedVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
        out.unmaskedRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        parameters[dbg.UNMASKED_VENDOR_WEBGL] = out.unmaskedVendor;
        parameters[dbg.UNMASKED_RENDERER_WEBGL] = out.unmaskedRenderer;
      } catch { /* skip */ }
    }
    return out;
  }

  function hygiene() {
    const issues = [];
    const dpr = window.devicePixelRatio;
    const mobile = /Mobile/.test(navigator.userAgent);
    if (!mobile && dpr !== 1) issues.push(`devicePixelRatio=${dpr}(桌面非整可能是缩放/高DPI屏,影响渲染类指纹)`);
    if (Math.abs(window.outerWidth - window.innerWidth) > 200) issues.push('窗口可能被缩放');
    return { devicePixelRatio: dpr, issues };
  }

  async function capture() {
    const nav = navigator;
    const p = { meta: {}, navigator: {}, screen: {}, window: {}, timezone: {} };

    p.navigator = {
      userAgent: nav.userAgent,
      appVersion: nav.appVersion,
      platform: nav.platform,
      vendor: nav.vendor,
      language: nav.language,
      languages: [...(nav.languages || [])],
      hardwareConcurrency: nav.hardwareConcurrency,
      deviceMemory: nav.deviceMemory,
      maxTouchPoints: nav.maxTouchPoints,
      cookieEnabled: nav.cookieEnabled,
    };

    if (nav.userAgentData) {
      try {
        const high = await nav.userAgentData.getHighEntropyValues(
          ['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList']
        );
        p.navigator.userAgentData = {
          brands: nav.userAgentData.brands,
          mobile: nav.userAgentData.mobile,
          platform: nav.userAgentData.platform,
          ...high,
        };
      } catch { /* skip */ }
    }

    // connection: rtt/downlink 是"天气"非身份,采集但下游不应当指纹用。
    if (nav.connection) {
      p.navigator.connection = {
        effectiveType: nav.connection.effectiveType,
        downlink: nav.connection.downlink,
        rtt: nav.connection.rtt,
        saveData: nav.connection.saveData,
      };
    }

    const s = window.screen;
    p.screen = {
      width: s.width, height: s.height, availWidth: s.availWidth, availHeight: s.availHeight,
      colorDepth: s.colorDepth, pixelDepth: s.pixelDepth,
      orientation: s.orientation ? { type: s.orientation.type, angle: s.orientation.angle } : undefined,
    };

    p.window = {
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      outerWidth: window.outerWidth, outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
      // window.chrome 存在性 —— host 判定的结构事实(Chrome 浏览器有 / WebView 无)。
      // 比 UA 的 wv 标记可靠:WebView 可自定义 UA 去掉 wv(如 via 浏览器),但难伪造 window.chrome。
      // 采浅 own-keys(非深结构),兼作 patch/chrome 回放的形状参考。
      chrome: window.chrome ? { ownKeys: Object.getOwnPropertyNames(window.chrome) } : null,
    };

    p.timezone = {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offset: new Date().getTimezoneOffset(),
    };

    let webgl = null;
    try { webgl = captureWebGL(); } catch { /* skip */ }
    if (webgl) p.webgl = webgl;

    p.meta = {
      source: 'capture',
      hygiene: hygiene(),
      // 每段保真度:real=真实采集 · params=仅查表(非渲染) · absent=未采集(渲染类,待检测器 profiling)
      fidelity: {
        navigator: 'real', screen: 'real', window: 'real', timezone: 'real',
        webgl: webgl ? 'params' : 'absent',
        canvas: 'absent', audio: 'absent', fonts: 'absent',
      },
    };
    return p;
  }

  if (typeof window !== 'undefined') window.__capture__ = capture;
  if (typeof module !== 'undefined') module.exports = { capture };
})();
