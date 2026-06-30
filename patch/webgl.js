/**
 * patch/webgl —— WebGL 指纹查表回放(getParameter 全表 + extensions + UNMASKED_*)。
 *
 * 根因:jsdom 无 WebGL → 最强硬件指纹整段缺失。纯数据回放(profile.webgl),不做真实渲染。
 * WebGL1/2 两个独立 iface;常量在 prototype(enumerable+frozen);数组参数返回 window-realm typed array;
 * debug_renderer_info 扩展对象不用 mask.iface(避免造全局 EXTRA)。profile.webgl 缺则整段不装。
 * getShaderPrecisionFormat 查 profile.webgl.shaderPrecision 表,返回 WebGLShaderPrecisionFormat 实例。
 *
 * 已知未尽项:常量为精简集(键数有差);webgl1 复用 webgl2 表(VERSION 串不对);
 * getExtension 仅实现 debug_renderer_info(其余返 null)。
 */

// 常量名→标准 enum 值(WebGL 规范定义,跨设备/版本恒定,host 无关)。
const GL_CONSTANTS = {
  VERSION: 7938, SHADING_LANGUAGE_VERSION: 35724, VENDOR: 7936, RENDERER: 7937,
  MAX_TEXTURE_SIZE: 3379, MAX_VIEWPORT_DIMS: 3386, MAX_RENDERBUFFER_SIZE: 34024,
  MAX_VERTEX_ATTRIBS: 34921, MAX_VERTEX_UNIFORM_VECTORS: 36347, MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
  MAX_VARYING_VECTORS: 36348, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661, MAX_TEXTURE_IMAGE_UNITS: 34930,
  MAX_CUBE_MAP_TEXTURE_SIZE: 34076, ALIASED_LINE_WIDTH_RANGE: 33902, ALIASED_POINT_SIZE_RANGE: 33901,
  // getShaderPrecisionFormat 参数常量
  FRAGMENT_SHADER: 35632, VERTEX_SHADER: 35633,
  LOW_FLOAT: 36336, MEDIUM_FLOAT: 36337, HIGH_FLOAT: 36338,
  LOW_INT: 36339, MEDIUM_INT: 36340, HIGH_INT: 36341,
};

// debug_renderer_info 扩展常量(住扩展对象原型,非 context 原型)。
const DEBUG_EXT_CONSTANTS = { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };

// getParameter 返回 typed array 的 enum → 构造器名([实测];未列的返回标量/字符串原样)。
const TYPED_PARAM = { 3386: 'Int32Array', 33901: 'Float32Array', 33902: 'Float32Array' };

// getContextAttributes 默认值([实测,空 options]):真机返回普通 Object(constructor=Object)。
const CONTEXT_ATTRS = {
  alpha: true, antialias: true, depth: true, desynchronized: false, failIfMajorPerformanceCaveat: false,
  powerPreference: 'default', premultipliedAlpha: true, preserveDrawingBuffer: false, stencil: false, xrCompatible: false,
};

export default {
  name: 'webgl',
  after: [],
  apply({ window, profile, mask }) {
    const wg = profile.section('webgl');
    if (!wg || !wg.parameters) return; // 未采 GPU → 不伪造,getContext 维持 null(同 jsdom 原样)
    const params = wg.parameters;       // { "<enum>": 标量|数组 },key 为字符串化 enum
    const extensions = wg.extensions || [];
    const shaderPrec = wg.shaderPrecision || {}; // { "shaderType-precisionType": {precision,rangeMin,rangeMax} }
    const TYPED_CTOR = { Int32Array: window.Int32Array, Float32Array: window.Float32Array, Uint32Array: window.Uint32Array };

    // 扩展对象 WEBGL_debug_renderer_info:Object.create(extProto),tag + 两常量住 extProto(→ window.Object.prototype)。
    const extProto = mask.tag(mask.adopt({}), 'WebGLDebugRendererInfo');
    for (const [name, val] of Object.entries(DEBUG_EXT_CONSTANTS)) {
      Object.defineProperty(extProto, name, { value: val, enumerable: true, writable: false, configurable: false });
    }
    const debugExt = Object.create(extProto);

    const ctxCanvas = new WeakMap(); // context 实例 → 关联 <canvas>(per-instance canvas/drawingBuffer* accessor)

    // WebGLShaderPrecisionFormat:真机属性为 prototype getter 读内部槽,WeakMap 模拟。
    const spfIface = mask.iface('WebGLShaderPrecisionFormat');
    const spfData = new WeakMap();
    mask.instAccessors(spfIface.proto, {
      rangeMin: function () { return spfData.get(this)?.rangeMin ?? 0; },
      rangeMax: function () { return spfData.get(this)?.rangeMax ?? 0; },
      precision: function () { return spfData.get(this)?.precision ?? 0; },
    });
    const makeSpf = (entry) => {
      const obj = spfIface.create({});
      spfData.set(obj, entry);
      return obj;
    };

    const setupProto = (proto) => {
      // 常量:真机形态 enumerable + 非 writable + 非 configurable。
      for (const [name, val] of Object.entries(GL_CONSTANTS)) {
        Object.defineProperty(proto, name, { value: val, enumerable: true, writable: false, configurable: false });
      }
      mask.methods(proto, {
        getParameter: [1, function getParameter(pname) {
          const v = params[pname];
          if (v === undefined) return null;
          if (Array.isArray(v)) return new (TYPED_CTOR[TYPED_PARAM[pname]] || window.Float32Array)(v); // window-realm typed array
          return v; // 字符串/数字 primitive,无 realm 之分
        }],
        getSupportedExtensions: [0, function getSupportedExtensions() { return mask.adopt(extensions.slice()); }],
        getExtension: [1, function getExtension(name) { return name === 'WEBGL_debug_renderer_info' ? debugExt : null; }],
        getContextAttributes: [0, function getContextAttributes() { return mask.adopt({ ...CONTEXT_ATTRS }); }],
        getShaderPrecisionFormat: [2, function getShaderPrecisionFormat(shaderType, precisionType) {
          const entry = shaderPrec[shaderType + '-' + precisionType];
          if (!entry) return null;
          return makeSpf(entry);
        }],
      });
      // per-instance accessor:读 this 取关联 <canvas>(mask.instAccessor 的实例态 getter)。
      mask.instAccessors(proto, {
        canvas: function () { return ctxCanvas.get(this) || null; },
        drawingBufferWidth: function () { const c = ctxCanvas.get(this); return c ? c.width : 0; },
        drawingBufferHeight: function () { const c = ctxCanvas.get(this); return c ? c.height : 0; },
      });
    };

    const webgl1 = mask.iface('WebGLRenderingContext');
    const webgl2 = mask.iface('WebGL2RenderingContext');
    setupProto(webgl1.proto);
    setupProto(webgl2.proto);

    const cache1 = new WeakMap(); const cache2 = new WeakMap();
    const ctxFor = (canvas, reg, cache) => {
      let c = cache.get(canvas);
      if (!c) { c = reg.create({}); ctxCanvas.set(c, canvas); cache.set(canvas, c); }
      return c;
    };
    mask.registerContext('webgl', (canvas) => ctxFor(canvas, webgl1, cache1));
    mask.registerContext('experimental-webgl', (canvas) => ctxFor(canvas, webgl1, cache1));
    mask.registerContext('webgl2', (canvas) => ctxFor(canvas, webgl2, cache2));
  },
};
