/**
 * patch/webgl.test.js —— WebGL 查表回放 realm 自测(harness 不探 webgl,故此为其唯一回归门)。
 *   node patch/webgl.test.js
 * 对两份含 webgl 段的真机 profile(mac desktop / android webview)各建 realm,验收:
 *   getContext 非 null · getParameter 查表=profile 值 · instanceof/toStringTag · 单例 · canvas 身份,
 * 并锁住两条跨 realm 陷阱:typed array 须 instanceof window.Int32Array/Float32Array;扩展对象不得注册 window 全局。
 */
import { Realm } from '../core/realm.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILES = path.resolve(HERE, '../profiles');

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const CODE = `(() => {
  const cv = document.createElement('canvas');
  const gl2 = cv.getContext('webgl2');
  const gl1 = cv.getContext('webgl');
  const dbg = gl2.getExtension('WEBGL_debug_renderer_info');
  // getShaderPrecisionFormat:profile 有 shaderPrecision 则查表,否则返 null
  const spf = gl2.getShaderPrecisionFormat(gl2.VERTEX_SHADER, gl2.HIGH_FLOAT);
  const spf2 = gl2.getShaderPrecisionFormat(gl2.FRAGMENT_SHADER, gl2.LOW_INT);
  const spfBad = gl2.getShaderPrecisionFormat(99999, 99999);
  const spfResult = { spfBad, hasGlobalSPF: typeof WebGLShaderPrecisionFormat,
    spf_native: gl2.getShaderPrecisionFormat.toString() };
  if (spf) {
    Object.assign(spfResult, {
      spf_notNull: true,
      spf_tag: Object.prototype.toString.call(spf),
      spf_instanceof: spf instanceof WebGLShaderPrecisionFormat,
      spf_precision: spf.precision, spf_rangeMin: spf.rangeMin, spf_rangeMax: spf.rangeMax,
      spf_ownKeys: Object.getOwnPropertyNames(spf).length,
      spf2_precision: spf2.precision, spf2_rangeMin: spf2.rangeMin,
    });
  }
  return {
    gl2_notNull: !!gl2, gl1_notNull: !!gl1,
    tag2: Object.prototype.toString.call(gl2),
    instanceof2: gl2 instanceof WebGL2RenderingContext,
    independent: !(gl2 instanceof WebGLRenderingContext),
    VENDOR: gl2.getParameter(gl2.VENDOR),
    RENDERER: gl2.getParameter(gl2.RENDERER),
    VERSION: gl2.getParameter(gl2.VERSION),
    MAX_TEXTURE_SIZE: gl2.getParameter(gl2.MAX_TEXTURE_SIZE),
    viewportDims: Array.from(gl2.getParameter(gl2.MAX_VIEWPORT_DIMS)),
    viewportIsInt32: gl2.getParameter(gl2.MAX_VIEWPORT_DIMS) instanceof Int32Array,
    aliasedIsFloat32: gl2.getParameter(gl2.ALIASED_LINE_WIDTH_RANGE) instanceof Float32Array,
    unmaskedVendor: gl2.getParameter(dbg.UNMASKED_VENDOR_WEBGL),
    unmaskedRenderer: gl2.getParameter(dbg.UNMASKED_RENDERER_WEBGL),
    dbg_tag: Object.prototype.toString.call(dbg),
    dbg_ctorName: dbg.constructor.name,
    dbg_ownKeys: Object.getOwnPropertyNames(dbg).length,
    noGlobalDebugIface: typeof globalThis.WebGLDebugRendererInfo,
    hasGlobalWebGL2: typeof WebGL2RenderingContext,
    getParameter_str: gl2.getParameter.toString(),
    supportedCount: gl2.getSupportedExtensions().length,
    supportedIsArray: gl2.getSupportedExtensions() instanceof Array,
    canvas_identity: gl2.canvas === cv,
    sameCtx: gl2 === cv.getContext('webgl2'),
    unknownParam: gl2.getParameter(999999),
    ...spfResult,
  };
})()`;

for (const profName of ['macos-chrome-v148', 'android-webview-v138', 'android-chrome/22126rn91y-v139-59164']) {
  const exp = JSON.parse(fs.readFileSync(path.join(PROFILES, `${profName}.json`), 'utf8')).webgl;
  const realm = await Realm.create({ profile: profName });
  const r = realm.run(CODE);
  console.log(`\n[${profName}]`);
  if (!r.ok) { ok(`realm 执行成功`, false); console.log(`    ${r.error}`); realm.dispose(); continue; }
  const v = r.value;
  ok('getContext webgl2/webgl 非 null', v.gl2_notNull && v.gl1_notNull);
  ok('tag2 [object WebGL2RenderingContext]', v.tag2 === '[object WebGL2RenderingContext]');
  ok('gl2 instanceof WebGL2RenderingContext', v.instanceof2 === true);
  ok('WebGL2 不继承 WebGL1(独立接口)', v.independent === true);
  ok('VENDOR 查表=profile', v.VENDOR === exp.parameters['7936']);
  ok('RENDERER 查表=profile', v.RENDERER === exp.parameters['7937']);
  ok('VERSION 查表=profile', v.VERSION === exp.parameters['7938']);
  ok('MAX_TEXTURE_SIZE 查表=profile', v.MAX_TEXTURE_SIZE === exp.parameters['3379']);
  ok('MAX_VIEWPORT_DIMS 值=profile', JSON.stringify(v.viewportDims) === JSON.stringify(exp.parameters['3386']));
  ok('[陷阱] MAX_VIEWPORT_DIMS instanceof window.Int32Array', v.viewportIsInt32 === true);
  ok('[陷阱] ALIASED_LINE_WIDTH_RANGE instanceof window.Float32Array', v.aliasedIsFloat32 === true);
  ok('UNMASKED_VENDOR 查表=profile', v.unmaskedVendor === exp.unmaskedVendor);
  ok('UNMASKED_RENDERER 查表=profile', v.unmaskedRenderer === exp.unmaskedRenderer);
  ok('dbg tag [object WebGLDebugRendererInfo]', v.dbg_tag === '[object WebGLDebugRendererInfo]');
  ok('dbg constructor.name=Object 且 own keys 为空', v.dbg_ctorName === 'Object' && v.dbg_ownKeys === 0);
  ok('[陷阱] 无 window.WebGLDebugRendererInfo 全局', v.noGlobalDebugIface === 'undefined');
  ok('有 window.WebGL2RenderingContext 全局', v.hasGlobalWebGL2 === 'function');
  ok('getParameter toString 为 native', v.getParameter_str === 'function getParameter() { [native code] }');
  ok('getSupportedExtensions 数=profile 且 instanceof window.Array', v.supportedCount === exp.extensions.length && v.supportedIsArray);
  ok('gl.canvas === 创建它的 canvas', v.canvas_identity === true);
  ok('同 canvas 同 type 单例', v.sameCtx === true);
  ok('未知 enum getParameter → null', v.unknownParam === null);
  // getShaderPrecisionFormat — 方法形态(不依赖数据)
  ok('getShaderPrecisionFormat toString 为 native', v.spf_native === 'function getShaderPrecisionFormat() { [native code] }');
  ok('未知 shaderType/precisionType → null', v.spfBad === null);
  ok('有 window.WebGLShaderPrecisionFormat 全局', v.hasGlobalSPF === 'function');
  // 值验证(仅当 profile 含 shaderPrecision 数据)
  const sp = exp.shaderPrecision;
  if (sp) {
    ok('spf 非 null', v.spf_notNull === true);
    ok('spf tag [object WebGLShaderPrecisionFormat]', v.spf_tag === '[object WebGLShaderPrecisionFormat]');
    ok('spf instanceof WebGLShaderPrecisionFormat', v.spf_instanceof === true);
    ok('spf precision=profile(VERTEX+HIGH_FLOAT)', v.spf_precision === sp['35633-36338']?.precision);
    ok('spf rangeMin=profile', v.spf_rangeMin === sp['35633-36338']?.rangeMin);
    ok('spf rangeMax=profile', v.spf_rangeMax === sp['35633-36338']?.rangeMax);
    ok('[陷阱] spf own keys 为空(属性在 prototype)', v.spf_ownKeys === 0);
    ok('spf2(FRAG+LOW_INT) precision=profile', v.spf2_precision === sp['35632-36339']?.precision);
  } else {
    console.log('  ⊘ shaderPrecision 数据缺,跳过值验证');
  }
  realm.dispose();
}

console.log(`\nwebgl 查表回放自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
