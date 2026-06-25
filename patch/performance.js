/**
 * patch/performance —— 补 performance 时序面(jsdom 仅有 now/timeOrigin/toJSON,缺整片 Performance Timeline)。
 *
 * 为什么:Akamai BMS 的资源指纹(iG904 取 getEntriesByType('resource') 前 15 条做哈希)拿不到数据 —— 真实页面
 * 必有 15+ 资源,空集是 headless tell;navigation timing(performance.timing / PerformanceNavigationTiming)与
 * PerformanceObserver 同缺,Akamai 亦读。对照 node_akamai init/bms.js 手 stub getEntriesByType。
 *
 * 现状[实测]装配后:performance.{getEntries,getEntriesByType,getEntriesByName,timing,navigation}、
 * PerformanceObserver、PerformanceEntry/ResourceTiming 全 undefined;now/timeOrigin 存在。
 *
 * 本补丁为 stub(结构保真级,非身份值):条目结构/原型/instanceof/时间戳自洽对齐真机,条目集合为同源合成
 * (真机 resource 名集属采集面,未采 → 合成 N 条 plausible 同源资源,胜过空集这一确定 tell)。
 * 已知未尽项:① 条目数据走实例 own 键(真机为 PerformanceEntry.prototype 上 getter + 实例空 own 键);
 * ② 条目集合非真机采集值。两者待条目进 probe 集 / 采集面补全后精化(见 br)。
 */

// 同源资源条目时间戳锚定小值(≤ ~9ms):performance.now() 自 realm 建起即 >10ms,保证 responseEnd ≤ now
// 自洽(真机里资源在过去加载完,now 必大于其 responseEnd)。脚本读 performance 多在 load 后,now 远大于此。
function buildEntries(window, mask) {
  const origin = window.location.origin && window.location.origin !== 'null'
    ? window.location.origin
    : 'https://example.com';
  const { adopt } = mask;

  const RTProto = window.PerformanceResourceTiming.prototype;
  const NavProto = window.PerformanceNavigationTiming.prototype;
  const PaintProto = window.PerformancePaintTiming.prototype;

  // 实例:数据作 own 键(stub;真机为原型 getter + 空实例 —— 已知未尽,见头注)。adopt 对齐 window 身份。
  const make = (proto, fields) => Object.assign(Object.create(proto), fields);

  const kinds = ['script', 'link', 'img', 'css', 'fetch'];
  const exts = { script: '.js', link: '.css', img: '.png', css: '.css', fetch: '' };
  const resources = [];
  for (let i = 0; i < 16; i++) {
    const initiatorType = kinds[i % kinds.length];
    const startTime = +(0.6 + i * 0.45).toFixed(3);          // 0.6 .. ~7.4ms
    const responseEnd = +(startTime + 1.1).toFixed(3);       // < ~8.5ms
    const duration = +(responseEnd - startTime).toFixed(3);
    resources.push(make(RTProto, {
      name: `${origin}/etc.clientlibs/app/r${i}${exts[initiatorType] || ''}`,
      entryType: 'resource', startTime, duration, initiatorType,
      nextHopProtocol: 'h2',
      workerStart: 0, redirectStart: 0, redirectEnd: 0,
      fetchStart: startTime, domainLookupStart: startTime, domainLookupEnd: startTime,
      connectStart: startTime, connectEnd: startTime, secureConnectionStart: startTime,
      requestStart: +(startTime + 0.2).toFixed(3), responseStart: +(startTime + 0.7).toFixed(3), responseEnd,
      transferSize: 0, encodedBodySize: 1024 + i * 32, decodedBodySize: 2048 + i * 64,
      responseStatus: 200, renderBlockingStatus: 'non-blocking',
    }));
  }

  const navigation = make(NavProto, {
    name: window.location.href, entryType: 'navigation', startTime: 0, duration: 8.7,
    initiatorType: 'navigation', nextHopProtocol: 'h2', type: 'navigate', redirectCount: 0,
    workerStart: 0, redirectStart: 0, redirectEnd: 0,
    fetchStart: 0.1, domainLookupStart: 0.2, domainLookupEnd: 0.3, connectStart: 0.3, connectEnd: 0.5,
    secureConnectionStart: 0.4, requestStart: 0.6, responseStart: 1.2, responseEnd: 1.8,
    transferSize: 1100, encodedBodySize: 800, decodedBodySize: 3200,
    unloadEventStart: 0, unloadEventEnd: 0, domInteractive: 5.0, domContentLoadedEventStart: 5.2,
    domContentLoadedEventEnd: 5.4, domComplete: 8.4, loadEventStart: 8.5, loadEventEnd: 8.7,
  });

  const paints = [
    make(PaintProto, { name: 'first-paint', entryType: 'paint', startTime: 6.1, duration: 0 }),
    make(PaintProto, { name: 'first-contentful-paint', entryType: 'paint', startTime: 6.3, duration: 0 }),
  ];

  return { resource: resources.map(adopt), navigation: [adopt(navigation)], paint: paints.map(adopt) };
}

export default {
  name: 'performance',
  after: ['window'],
  apply({ window, mask }) {
    const { native, adopt, method, methods } = mask;
    const W = window;
    const P = W.performance;
    const PerfProto = W.Performance && W.Performance.prototype;
    if (!PerfProto) return; // jsdom 无 Performance(理论不至) → 跳过

    // ── 1. Performance Timeline 接口类族(illegal constructor;真机 PerformanceEntry 等不可 new)──
    const entryBase = mask.iface('PerformanceEntry');      // 基类
    const rt = mask.iface('PerformanceResourceTiming');
    Object.setPrototypeOf(rt.proto, entryBase.proto);
    const navT = mask.iface('PerformanceNavigationTiming');
    Object.setPrototypeOf(navT.proto, rt.proto);           // 真机:NavigationTiming extends ResourceTiming
    const paintT = mask.iface('PerformancePaintTiming');
    Object.setPrototypeOf(paintT.proto, entryBase.proto);
    mask.iface('PerformanceMark');
    mask.iface('PerformanceMeasure');

    // ── 2. 合成条目 + Performance.prototype 查询方法(native)──
    const E = buildEntries(W, mask);
    const all = () => [...E.navigation, ...E.paint, ...E.resource];
    method(PerfProto, 'getEntries', 0, () => adopt(all()));
    method(PerfProto, 'getEntriesByType', 1, (type) => adopt((E[String(type)] || []).slice()));
    method(PerfProto, 'getEntriesByName', 2, (name, type) =>
      adopt(all().filter((e) => e.name === name && (type == null || e.entryType === type))));
    // mark/measure:User Timing 壳(返回条目;不维护内部缓冲)。
    if (typeof PerfProto.mark !== 'function') {
      method(PerfProto, 'mark', 1, (name) => adopt(Object.assign(Object.create(W.PerformanceMark.prototype),
        { name: String(name), entryType: 'mark', startTime: P.now(), duration: 0 })));
    }
    if (typeof PerfProto.measure !== 'function') {
      method(PerfProto, 'measure', 1, (name) => adopt(Object.assign(Object.create(W.PerformanceMeasure.prototype),
        { name: String(name), entryType: 'measure', startTime: 0, duration: P.now() })));
    }
    if (typeof PerfProto.clearResourceTimings !== 'function') method(PerfProto, 'clearResourceTimings', 0, () => undefined);
    if (typeof PerfProto.clearMarks !== 'function') method(PerfProto, 'clearMarks', 0, () => undefined);
    if (typeof PerfProto.clearMeasures !== 'function') method(PerfProto, 'clearMeasures', 0, () => undefined);
    if (typeof PerfProto.setResourceTimingBufferSize !== 'function') method(PerfProto, 'setResourceTimingBufferSize', 1, () => undefined);

    // ── 3. legacy performance.timing / navigation(已废弃但 Akamai 读)──
    // 时间戳锚定 timeOrigin(epoch ms),保持单调递增自洽。
    const t0 = Math.floor(P.timeOrigin || Date.now());
    const T = (off) => t0 + off;
    const timing = adopt({
      navigationStart: t0, unloadEventStart: 0, unloadEventEnd: 0, redirectStart: 0, redirectEnd: 0,
      fetchStart: T(1), domainLookupStart: T(1), domainLookupEnd: T(1), connectStart: T(1), connectEnd: T(1),
      secureConnectionStart: T(1), requestStart: T(2), responseStart: T(3), responseEnd: T(4),
      domLoading: T(5), domInteractive: T(6), domContentLoadedEventStart: T(6), domContentLoadedEventEnd: T(6),
      domComplete: T(8), loadEventStart: T(8), loadEventEnd: T(9),
    });
    const navigation = adopt({ type: 0, redirectCount: 0 }); // type 0 = TYPE_NAVIGATE
    Object.defineProperty(PerfProto, 'timing', { get: native(() => timing, 'get timing'), enumerable: true, configurable: true });
    Object.defineProperty(PerfProto, 'navigation', { get: native(() => navigation, 'get navigation'), enumerable: true, configurable: true });

    // ── 4. PerformanceObserver 壳(可 new;observe/disconnect/takeRecords)+ EntryList ──
    const OEL = mask.iface('PerformanceObserverEntryList');
    methods(OEL.proto, {
      getEntries: [0, () => adopt([])], getEntriesByType: [1, () => adopt([])], getEntriesByName: [2, () => adopt([])],
    });
    if (typeof W.PerformanceObserver !== 'function') {
      const Observer = native(function PerformanceObserver(cb) {
        if (!new.target) throw new W.TypeError("Failed to construct 'PerformanceObserver': Please use the 'new' operator.");
        if (typeof cb !== 'function') throw new W.TypeError("Failed to construct 'PerformanceObserver': parameter 1 is not of type 'PerformanceObserverCallback'.");
      }, 'PerformanceObserver', 1);
      const oproto = mask.tag(adopt({}), 'PerformanceObserver');
      methods(oproto, { observe: [1, () => undefined], disconnect: [0, () => undefined], takeRecords: [0, () => adopt([])] });
      Object.defineProperty(oproto, 'constructor', { value: Observer, writable: true, enumerable: false, configurable: true });
      Observer.prototype = oproto;
      // 静态 supportedEntryTypes:Akamai 读以判 PerformanceObserver 真伪。
      Object.defineProperty(Observer, 'supportedEntryTypes', {
        get: native(() => adopt(['element', 'event', 'first-input', 'largest-contentful-paint', 'layout-shift',
          'longtask', 'mark', 'measure', 'navigation', 'paint', 'resource']), 'get supportedEntryTypes'),
        enumerable: true, configurable: true,
      });
      W.PerformanceObserver = Observer;
    }
  },
};
