/**
 * patch/canvas.test.js —— Canvas 2D 壳 realm 自测(harness 不探 canvas,故此为其唯一回归门)。
 *   node patch/canvas.test.js
 * 跑一条真实 canvas 指纹链(getContext 2d → fillStyle/font/fillRect/fillText → measureText → getImageData →
 * toDataURL),验收**结构**(非指纹值,见 canvas.js"已知未尽项"):typeof/instanceof/toStringTag/方法 native/
 * 返回类型/单例/canvas 身份/new 抛 Illegal,并锁住 advisor 指出的盲点 —— 跨 patch getContext 组合:
 * canvas 与 webgl 两 hook 拓扑序未定,组合后 '2d'/'webgl'/'webgl2' 须皆可 resolve(各用独立 canvas,真机一
 * canvas 仅绑一种 context type)。
 */
import { Realm } from '../core/realm.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const CODE = `(() => {
  const cv = document.createElement('canvas');
  cv.width = 220; cv.height = 30;
  const ctx = cv.getContext('2d');
  // 真实指纹链(属性赋值 + no-op 绘制,均不得抛)
  ctx.textBaseline = 'top'; ctx.font = "14px 'Arial'";
  ctx.fillStyle = '#f60'; ctx.fillRect(125, 1, 62, 20);
  ctx.fillStyle = '#069'; ctx.fillText('mimic', 2, 15);
  ctx.beginPath(); ctx.arc(50, 15, 10, 0, 7); ctx.fill();
  const m = ctx.measureText('mimic');
  const img = ctx.getImageData(0, 0, 5, 5);
  const grad = ctx.createLinearGradient(0, 0, 10, 0); grad.addColorStop(0, '#fff');
  // Path2D 路径(真机可构造;ctx.fill(path) 须不崩)
  const p = new Path2D(); p.moveTo(0, 0); p.lineTo(10, 10); p.arc(5, 5, 3, 0, 7); p.closePath();
  ctx.fill(p); ctx.stroke(p);
  const url = cv.toDataURL();
  // 跨 patch getContext 组合(独立 canvas,各绑一种 type)
  const cv2 = document.createElement('canvas');
  const cv3 = document.createElement('canvas');
  return {
    typeof_CRC2D: typeof CanvasRenderingContext2D,
    ctx_notNull: !!ctx,
    instanceof_ctx: ctx instanceof CanvasRenderingContext2D,
    tag_ctx: Object.prototype.toString.call(ctx),
    fillRect_native: ctx.fillRect.toString(),
    getContext_native: cv.getContext.toString(),
    m_isTextMetrics: m instanceof TextMetrics,
    m_width_isNumber: typeof m.width === 'number',
    img_isImageData: img instanceof ImageData,
    img_data_isU8C: img.data instanceof Uint8ClampedArray,
    img_data_len: img.data.length,
    img_w: img.width, img_h: img.height,
    grad_isGradient: grad instanceof CanvasGradient,
    typeof_Path2D: typeof Path2D,
    p_isPath2D: p instanceof Path2D,
    url_isString: typeof url === 'string',
    url_isPng: url.slice(0, 14),
    ctx_canvas_identity: ctx.canvas === cv,
    singleton: ctx === cv.getContext('2d'),
    has_global_CRC2D: typeof CanvasRenderingContext2D === 'function',
    new_throws: (() => { try { new CanvasRenderingContext2D(); return false; } catch (e) { return e instanceof TypeError; } })(),
    combo_2d: !!cv2.getContext('2d'),
    combo_webgl2: !!cv3.getContext('webgl2'),
    combo_webgl1: !!document.createElement('canvas').getContext('webgl'),
  };
})()`;

// 用含 webgl 段的 profile,使组合测试中 webgl/webgl2 真正装配(webgl patch 门控:无 GPU 数据则不装)。
const realm = await Realm.create({ profile: 'macos-chrome-v148' });
const r = realm.run(CODE);
if (!r.ok) { ok('realm 执行成功', false); console.log(`    ${r.error}`); realm.dispose(); process.exit(1); }
const v = r.value;
console.log('\n[canvas 2d 壳]');
ok('typeof CanvasRenderingContext2D === function', v.typeof_CRC2D === 'function');
ok('getContext("2d") 非 null(真机绝不为 null)', v.ctx_notNull === true);
ok('ctx instanceof CanvasRenderingContext2D', v.instanceof_ctx === true);
ok('tag [object CanvasRenderingContext2D]', v.tag_ctx === '[object CanvasRenderingContext2D]');
ok('fillRect toString 为 native', v.fillRect_native === 'function fillRect() { [native code] }');
ok('getContext toString 为 native', v.getContext_native === 'function getContext() { [native code] }');
ok('measureText → TextMetrics 实例', v.m_isTextMetrics === true);
ok('TextMetrics.width 是 number', v.m_width_isNumber === true);
ok('getImageData → ImageData 实例', v.img_isImageData === true);
ok('ImageData.data instanceof window.Uint8ClampedArray', v.img_data_isU8C === true);
ok('ImageData.data.length = w*h*4 (5*5*4=100)', v.img_data_len === 100);
ok('ImageData width/height = 5/5', v.img_w === 5 && v.img_h === 5);
ok('createLinearGradient → CanvasGradient 实例', v.grad_isGradient === true);
ok('typeof Path2D === function(真机可构造)', v.typeof_Path2D === 'function');
ok('new Path2D() → instanceof Path2D + ctx.fill(path) 不崩', v.p_isPath2D === true);
ok('toDataURL 返回 string', v.url_isString === true);
ok('toDataURL 返回 data:image/png 串(真机绝不为 null)', v.url_isPng === 'data:image/png');
ok('new CanvasRenderingContext2D() 抛 window-realm TypeError(跨 realm 契约)', v.new_throws === true);
ok('ctx.canvas === 创建它的 canvas', v.ctx_canvas_identity === true);
ok('同 canvas getContext("2d") 单例', v.singleton === true);
ok('有 window.CanvasRenderingContext2D 全局', v.has_global_CRC2D === true);
console.log('\n[跨 patch getContext 组合]');
ok('canvas+webgl 组合后 getContext("2d") 仍 resolve', v.combo_2d === true);
ok('canvas+webgl 组合后 getContext("webgl2") 仍 resolve', v.combo_webgl2 === true);
ok('canvas+webgl 组合后 getContext("webgl") 仍 resolve', v.combo_webgl1 === true);
realm.dispose();

console.log(`\ncanvas 2d 壳自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
