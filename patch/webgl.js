/**
 * patch/webgl —— WebGL 指纹(GPU 型号 / 扩展 / 参数)。
 * 对照 sdenv: 从 profile.webgl 查表返回 getParameter 值。
 * TODO: 实现 WebGLRenderingContext.getParameter / getExtension('WEBGL_debug_renderer_info'),
 *       并对每个返回值用 profile.webgl.parameters 查表;方法用 mask.fn 包裹。
 */
export default {
  name: 'webgl',
  after: ['document'],
  apply(/* { window, profile, mask } */) {
    // stub
  },
};
