/**
 * patch/canvas —— Canvas 2D 指纹壳(构造器壳 + 原型方法 native 化 + getContext('2d') 受控壳)。
 *
 * 根因:jsdom 不带 canvas 包 —— canvas.getContext('2d') 返回 null、CanvasRenderingContext2D/ImageData/
 * TextMetrics/CanvasGradient 全 undefined、toDataURL() 返回 null。真机 getContext('2d') **永不**返 null
 * (与 webgl 的 getExtension 相反:那里 null 是合法真机响应、壳才是 tell;这里 null 真机绝不发生、缺壳即
 * tell,且用 canvas 的指纹脚本当场崩溃本身是更强的 tell)。故 canvas 的壳是**必须**的 —— webgl 那条
 * "空壳比缺失更易识破、宁可不给"的判断在此**反转**(同一原则"匹配真机",相反结论)。
 *
 * 范围(短期,对齐并超 sdenv 下限 —— sdenv 仅给一个空 getImageData):锚定指纹脚本真实触及的不崩调用链:
 *   getContext('2d') → fillStyle/font 赋值 + fillRect/fillText/arc(no-op 不抛) → measureText()→TextMetrics(.width)
 *   → toDataURL()→string / getImageData()→ImageData(.data 读) 。不投机建调用链外的接口(CanvasPattern 等)。
 *
 * 形态对照真机:CanvasRenderingContext2D/TextMetrics/ImageData/CanvasGradient 均真机 window 全局构造器
 * (new 抛 Illegal constructor)→ 用 mask.iface 注册 window.<Name> + instanceof 成立;实例由工厂方法
 * (getContext/measureText/getImageData/createLinearGradient)产出。getContext 同一 canvas 返回同一 2d
 * context(真机[实测]单例语义),canvas accessor 经 per-instance native getter 读关联 <canvas>。
 *
 * 已知未尽项(陈述现状,非真机保真;留 payload-keyed replay 长期解,harness 不探 canvas → 自测只验**结构**
 * typeof/instanceof/toString/方法 native/返回类型,**不验指纹值**):
 *  - toDataURL/getImageData/measureText 返回**结构有效占位**(正确 type/shape),非真机渲染像素/字体度量 →
 *    指纹**值**不保真;且占位固定 → 跨 mimic 实例字节相同(跨 session 关联 tell)。
 *  - 2d context 属性(fillStyle/font/textBaseline...)真机为 prototype accessor(setter 会规范化颜色等);
 *    此处未建 → 赋值落实例可写自有属性、读回非真机规范化值(不崩,值不保真)。
 *  - ImageData 的 data/width/height 真机为 prototype accessor,此处放实例 own data 属性(可读不崩,结构有差)。
 *  - new ImageData(w,h) 真机合法,此处经 mask.iface 抛 Illegal constructor(指纹少用,getImageData 是主路径)。
 *  - toBlob 未接管:jsdom 29 自带实现、调用[实测]不抛(满足"不崩"),但其 blob 内容非真机渲染(值不保真);
 *    OffscreenCanvas 未建(`new OffscreenCanvas` 抛,涉 worker/transferToImageBitmap,超短期范围)—— 二者均
 *    scoped-out,留长期。
 */

// 1x1 透明 PNG 占位(toDataURL 返回;非真机渲染,固定值 → 关联 tell,见上"已知未尽项")。
const PLACEHOLDER_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// CanvasRenderingContext2D.prototype 高频几何/绘制方法 → arity([规范];no-op 不抛,仅满足"用 canvas 不崩")。
const NOOP_METHODS = {
  save: 0, restore: 0, scale: 2, rotate: 1, translate: 2, transform: 6, setTransform: 6, resetTransform: 0,
  clearRect: 4, fillRect: 4, strokeRect: 4,
  beginPath: 0, closePath: 0, moveTo: 2, lineTo: 2, bezierCurveTo: 6, quadraticCurveTo: 4,
  arc: 5, arcTo: 5, ellipse: 7, rect: 4, roundRect: 3,
  fill: 0, stroke: 0, clip: 0,
  fillText: 2, strokeText: 2,
  setLineDash: 1, drawImage: 3, putImageData: 3,
};

export default {
  name: 'canvas',
  after: ['document'],
  apply({ window, mask }) {
    // 接口壳(真机全局构造器,iface 注册 window.<Name>,new 抛 Illegal,instanceof 成立)。
    const crc2d = mask.iface('CanvasRenderingContext2D');
    const textMetrics = mask.iface('TextMetrics');
    const imageData = mask.iface('ImageData');
    const gradient = mask.iface('CanvasGradient');

    // Path2D:真机**可构造**(new Path2D() / new Path2D(pathOrSvg)),非 Illegal —— 缺失则 `new Path2D()` 抛
    // ReferenceError、`ctx.fill(path)` 崩(违反"不崩")。建可构造壳 + 几何方法 no-op(ctx.fill/stroke/
    // isPointInPath 忽略 path 参数,本就 no-op)。
    const path2dProto = mask.adopt(mask.tag({}, 'Path2D'));
    const Path2D = mask.native(function Path2D() {
      if (!new.target) throw new window.TypeError("Failed to construct 'Path2D': Please use the 'new' operator.");
    }, 'Path2D', 0);
    Path2D.prototype = path2dProto;
    Object.defineProperty(path2dProto, 'constructor', { value: Path2D, configurable: true, enumerable: false });
    Object.defineProperty(window, 'Path2D', { value: Path2D, writable: true, configurable: true, enumerable: false });
    mask.methods(path2dProto, {
      addPath: [1, function addPath() {}], moveTo: [2, function moveTo() {}], lineTo: [2, function lineTo() {}],
      bezierCurveTo: [6, function bezierCurveTo() {}], quadraticCurveTo: [4, function quadraticCurveTo() {}],
      arc: [5, function arc() {}], arcTo: [5, function arcTo() {}], ellipse: [7, function ellipse() {}],
      rect: [4, function rect() {}], roundRect: [3, function roundRect() {}], closePath: [0, function closePath() {}],
    });

    const WUint8Clamped = window.Uint8ClampedArray;

    // CanvasGradient:createLinearGradient 等返回;addColorStop no-op(颜色指纹常经 gradient,故 include)。
    mask.methods(gradient.proto, { addColorStop: [2, function addColorStop() {}] });

    // TextMetrics 实例:measureText 返回,.width 等度量为占位(确定性、非真机字体度量;实例 own 可读)。
    const makeMetrics = (text) => {
      const m = textMetrics.create();
      const w = String(text == null ? '' : text).length * 7; // 占位度量:确定但非真机
      const metrics = {
        width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w,
        actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2,
        fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 3,
        emHeightAscent: 11, emHeightDescent: 3,
        hangingBaseline: 9, alphabeticBaseline: 0, ideographicBaseline: -3,
      };
      for (const [k, v] of Object.entries(metrics)) {
        Object.defineProperty(m, k, { value: v, enumerable: true, configurable: true });
      }
      return m;
    };

    // ImageData 实例:getImageData/createImageData 返回;.data 为 window-realm Uint8ClampedArray(全 0 占位)。
    const makeImageData = (w, h) => {
      const d = imageData.create();
      const px = Math.max(0, (w | 0) * (h | 0));
      Object.defineProperty(d, 'data', { value: new WUint8Clamped(px * 4), enumerable: true, configurable: false });
      Object.defineProperty(d, 'width', { value: w | 0, enumerable: true, configurable: false });
      Object.defineProperty(d, 'height', { value: h | 0, enumerable: true, configurable: false });
      Object.defineProperty(d, 'colorSpace', { value: 'srgb', enumerable: true, configurable: false });
      return d;
    };

    // CRC2D.prototype 方法集:no-op 几何/绘制 + 有返回值的工厂方法(经 mask.methods native 化)。
    const methods = {};
    for (const [n, len] of Object.entries(NOOP_METHODS)) methods[n] = [len, function () {}];
    Object.assign(methods, {
      measureText: [1, function measureText(text) { return makeMetrics(text); }],
      getImageData: [4, function getImageData(sx, sy, sw, sh) { return makeImageData(sw, sh); }],
      createImageData: [2, function createImageData(w, h) { return makeImageData(w, h); }],
      createLinearGradient: [4, function createLinearGradient() { return gradient.create(); }],
      createRadialGradient: [6, function createRadialGradient() { return gradient.create(); }],
      createConicGradient: [3, function createConicGradient() { return gradient.create(); }],
      isPointInPath: [2, function isPointInPath() { return false; }],
      isPointInStroke: [2, function isPointInStroke() { return false; }],
      getLineDash: [0, function getLineDash() { return mask.adopt([]); }],
    });
    mask.methods(crc2d.proto, methods);

    // per-instance canvas accessor:箭头 getter 读不了 this,自建读 this 的 native getter(对照 webgl)。
    const ctxCanvas = new WeakMap(); // 2d context 实例 → 关联 <canvas>
    Object.defineProperty(crc2d.proto, 'canvas', {
      get: mask.native(function canvas() { return ctxCanvas.get(this) || null; }, 'get canvas'),
      enumerable: true, configurable: true,
    });

    // getContext 接管:同一 canvas 的 '2d' 返回同一 context(真机单例);非 '2d' delegate 往下(2d/webgl/webgl2
    // 各 patch hook 同一 getContext、拓扑序未定,故两边都须 delegate 未知 type → 组合后三者皆可 resolve)。
    const cache = new WeakMap();
    const ctxFor = (canvas) => {
      let c = cache.get(canvas);
      if (!c) { c = crc2d.create({}); ctxCanvas.set(c, canvas); cache.set(canvas, c); }
      return c;
    };
    mask.hook(window.HTMLCanvasElement.prototype, 'getContext', (orig) => function getContext(type, attrs) {
      if (type === '2d') return ctxFor(this);
      return orig.call(this, type, attrs);
    });

    // toDataURL:jsdom 无渲染返回 null(真机绝不为 null)→ 覆盖为占位 PNG 串(值不保真,见"已知未尽项")。
    mask.hook(window.HTMLCanvasElement.prototype, 'toDataURL', () => function toDataURL() { return PLACEHOLDER_PNG; });
  },
};
