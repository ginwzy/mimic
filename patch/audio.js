/**
 * patch/audio —— Web Audio 指纹壳(可构造 context + 节点链 + getChannelData 占位)。
 *
 * 根因:jsdom 无 Web Audio 实现 —— OfflineAudioContext/AudioContext/AudioBuffer/各 AudioNode 全 undefined →
 * audio 指纹脚本(`new OfflineAudioContext(...)` 起手)当场 ReferenceError/TypeError 崩溃。真机这些全是 window
 * 全局,缺失即 tell(同 canvas:真机永远能跑 audio 指纹链)。
 *
 * 范围(短期,超 sdenv —— sdenv 完全无 audio):锚定指纹脚本真实触及的不崩调用链:
 *   new OfflineAudioContext(ch,len,rate) → createOscillator()/createDynamicsCompressor()/createGain() →
 *   node.connect(dest) 链 → osc.start() → startRendering()→Promise<AudioBuffer> → buffer.getChannelData(0)→Float32Array。
 *   不投机建链外节点(PannerNode/ConvolverNode 等)。
 *
 * 形态对照真机:
 *  - OfflineAudioContext/AudioContext/AudioBuffer 真机**可 new**(非 Illegal constructor)→ 用自建可构造壳
 *    ctorIface(区别 mask.iface 的"new 即抛");webkitAudioContext/webkitOfflineAudioContext 别名指向同 ctor。
 *  - 各 AudioNode(Oscillator/DynamicsCompressor/Gain/Analyser/BufferSource/Destination)经工厂方法产出 →
 *    用 mask.iface(new 抛 Illegal)+ 子类 proto 继承 AudioNode 基类(connect/disconnect 住基类原型,真机如此)。
 *  - AudioParam(frequency/detune/gain/threshold...)经 mask.iface;.value 可写、ramp/setValueAtTime 链式返 this。
 *  - node.connect(node) 返回被连 node(真机链式语义),故 osc.connect(comp).connect(ctx.destination) 成立。
 *
 * 已知未尽项(陈述现状,非真机保真;留 payload-keyed replay 长期解,harness 不探 audio → 自测只验**结构**,
 * 不验指纹值):
 *  - getChannelData 返回**全 0 占位** Float32Array(正确 type/length),非真机渲染样本 → 音频指纹**值**不保真,
 *    且固定 → 跨 mimic 实例相同(关联 tell)。
 *  - 跳过 BaseAudioContext/AudioScheduledSourceNode/EventTarget 中间继承层(各 Node 直接继承 AudioNode 基类;
 *    EventTarget 方法装 context proto 自身而非继承 EventTarget.prototype,规避 jsdom brand-check),原型链深度
 *    与真机有差(结构缺口)。
 *  - oncomplete/addEventListener('complete') 双路径均触发(FingerprintJS2 主路径已覆盖),但 complete 事件对象
 *    为普通 tagged 对象(非真机 OfflineAudioCompletionEvent 实例);AudioParam/node 的 value/type 为实例 own
 *    data(真机为 prototype accessor)。
 */

export default {
  name: 'audio',
  after: [],
  apply({ window, mask }) {
    const WFloat32 = window.Float32Array;

    // 可构造接口壳:区别 mask.iface(new 抛 Illegal),真机 context/buffer 可 new。init(self,args) 写私有状态。
    const ctorIface = (name, len, init) => {
      const proto = mask.adopt(mask.tag({}, name));
      const ctor = mask.native(function (...args) {
        // window-realm TypeError:对齐 mask.iface 的跨 realm 契约(页面 instanceof TypeError 须为 true)。
        if (!new.target) throw new window.TypeError(`Failed to construct '${name}': Please use the 'new' operator.`);
        if (init) init(this, args);
      }, name, len);
      ctor.prototype = proto;
      Object.defineProperty(proto, 'constructor', { value: ctor, configurable: true, enumerable: false });
      Object.defineProperty(window, name, { value: ctor, writable: true, configurable: true, enumerable: false });
      return { ctor, proto, create: (extra = {}) => Object.assign(Object.create(proto), extra) };
    };

    // 读 this 的 native getter(箭头读不了 this,对照 webgl 的 canvas accessor)。
    const instGetter = (proto, name, get) =>
      Object.defineProperty(proto, name, { get: mask.native(get, `get ${name}`), enumerable: true, configurable: true });

    // 简易 EventTarget(装 context proto 自身,不继承 jsdom EventTarget.prototype —— 后者 webidl brand-check 对
    // 非 jsdom 实例抛 Illegal invocation,见 issue gow;故自维护 listener map)。真机 EventTarget 方法住
    // EventTarget.prototype、context 经原型链继承(此处装 proto 自身,原型链深度有差,记"已知未尽项")。
    const listeners = new WeakMap();
    const fireEvent = (target, type, ev) => {
      const m = listeners.get(target);
      if (m && m[type]) for (const fn of m[type].slice()) { try { fn.call(target, ev); } catch { /* listener 抛不外溢 */ } }
      const on = target['on' + type];
      if (typeof on === 'function') { try { on.call(target, ev); } catch { /* noop */ } }
    };
    const installEventTarget = (proto) => mask.methods(proto, {
      addEventListener: [2, function addEventListener(type, fn) {
        if (typeof fn !== 'function') return;
        let m = listeners.get(this); if (!m) { m = Object.create(null); listeners.set(this, m); }
        (m[type] || (m[type] = [])).push(fn);
      }],
      removeEventListener: [2, function removeEventListener(type, fn) {
        const m = listeners.get(this); if (m && m[type]) m[type] = m[type].filter((f) => f !== fn);
      }],
      dispatchEvent: [1, function dispatchEvent(ev) { fireEvent(this, ev && ev.type, ev); return true; }],
    });

    // ── AudioParam:frequency/detune/gain/threshold... ──
    const audioParam = mask.iface('AudioParam');
    mask.methods(audioParam.proto, {
      setValueAtTime: [2, function setValueAtTime() { return this; }],
      linearRampToValueAtTime: [2, function linearRampToValueAtTime() { return this; }],
      exponentialRampToValueAtTime: [2, function exponentialRampToValueAtTime() { return this; }],
      setTargetAtTime: [3, function setTargetAtTime() { return this; }],
      setValueCurveAtTime: [3, function setValueCurveAtTime() { return this; }],
      cancelScheduledValues: [1, function cancelScheduledValues() { return this; }],
      cancelAndHoldAtTime: [1, function cancelAndHoldAtTime() { return this; }],
    });
    // value 为实例可写 own(真机 prototype accessor,见"已知未尽项");default/min/max 占位。
    const makeParam = (defaultValue, minValue, maxValue) =>
      audioParam.create({ value: defaultValue, defaultValue, minValue, maxValue });

    // ── AudioNode 基类 + 子类(子类 proto 继承基类 → connect/disconnect 住基类原型,真机如此) ──
    const audioNode = mask.iface('AudioNode');
    mask.methods(audioNode.proto, {
      connect: [1, function connect(dest) { return dest; }], // 真机链式:返回被连 node
      disconnect: [0, function disconnect() {}],
    });
    const nodeIface = (name, methods) => {
      const n = mask.iface(name);
      Object.setPrototypeOf(n.proto, audioNode.proto); // extends AudioNode
      if (methods) mask.methods(n.proto, methods);
      return n;
    };
    const oscillatorNode = nodeIface('OscillatorNode', {
      start: [1, function start() {}], stop: [1, function stop() {}], setPeriodicWave: [1, function setPeriodicWave() {}],
    });
    const dynamicsCompressorNode = nodeIface('DynamicsCompressorNode');
    const gainNode = nodeIface('GainNode');
    const analyserNode = nodeIface('AnalyserNode', {
      getFloatFrequencyData: [1, function getFloatFrequencyData() {}],
      getByteFrequencyData: [1, function getByteFrequencyData() {}],
      getFloatTimeDomainData: [1, function getFloatTimeDomainData() {}],
      getByteTimeDomainData: [1, function getByteTimeDomainData() {}],
    });
    const bufferSourceNode = nodeIface('AudioBufferSourceNode', {
      start: [1, function start() {}], stop: [1, function stop() {}],
    });
    const destinationNode = nodeIface('AudioDestinationNode');

    // ── AudioBuffer(可构造):getChannelData → 全 0 占位 Float32Array;length/sampleRate/... 读私有状态 ──
    const bufState = new WeakMap();
    const audioBuffer = ctorIface('AudioBuffer', 1, (self, [opts]) => {
      const o = opts || {};
      bufState.set(self, { numCh: o.numberOfChannels || 1, length: o.length || 0, sampleRate: o.sampleRate || 44100 });
    });
    const makeBuffer = (numCh, length, sampleRate) => {
      const b = audioBuffer.create();
      bufState.set(b, { numCh: numCh || 1, length: length || 0, sampleRate: sampleRate || 44100 });
      return b;
    };
    mask.methods(audioBuffer.proto, {
      getChannelData: [1, function getChannelData() { return new WFloat32((bufState.get(this) || {}).length || 0); }],
      copyFromChannel: [3, function copyFromChannel() {}],
      copyToChannel: [3, function copyToChannel() {}],
    });
    instGetter(audioBuffer.proto, 'length', function length() { return (bufState.get(this) || {}).length || 0; });
    instGetter(audioBuffer.proto, 'sampleRate', function sampleRate() { return (bufState.get(this) || {}).sampleRate || 0; });
    instGetter(audioBuffer.proto, 'numberOfChannels', function numberOfChannels() { return (bufState.get(this) || {}).numCh || 0; });
    instGetter(audioBuffer.proto, 'duration', function duration() {
      const s = bufState.get(this) || {}; return s.sampleRate ? (s.length || 0) / s.sampleRate : 0;
    });

    // ── context 工厂方法(真机住 BaseAudioContext.prototype;此处装各 context proto,跳过中间层) ──
    const ctxDest = new WeakMap();
    const installFactory = (proto, stateOf) => {
      mask.methods(proto, {
        createOscillator: [0, function createOscillator() {
          return oscillatorNode.create({ type: 'sine', frequency: makeParam(440, 0, 0), detune: makeParam(0, 0, 0) });
        }],
        createDynamicsCompressor: [0, function createDynamicsCompressor() {
          return dynamicsCompressorNode.create({
            threshold: makeParam(-24, -100, 0), knee: makeParam(30, 0, 40), ratio: makeParam(12, 1, 20),
            reduction: 0, attack: makeParam(0.003, 0, 1), release: makeParam(0.25, 0, 1),
          });
        }],
        createGain: [0, function createGain() { return gainNode.create({ gain: makeParam(1, -3.4028234663852886e38, 3.4028234663852886e38) }); }],
        createAnalyser: [0, function createAnalyser() { return analyserNode.create({ fftSize: 2048, frequencyBinCount: 1024 }); }],
        createBufferSource: [0, function createBufferSource() { return bufferSourceNode.create({ buffer: null }); }],
        createBuffer: [3, function createBuffer(numCh, length, sampleRate) { return makeBuffer(numCh, length, sampleRate); }],
        decodeAudioData: [1, function decodeAudioData() { return mask.promise(makeBuffer(1, 0, 44100)); }],
      });
      instGetter(proto, 'destination', function destination() {
        let d = ctxDest.get(this); if (!d) { d = destinationNode.create({ maxChannelCount: 2 }); ctxDest.set(this, d); } return d;
      });
      instGetter(proto, 'sampleRate', function sampleRate() { return (stateOf(this) || {}).sampleRate || 44100; });
      instGetter(proto, 'currentTime', function currentTime() { return 0; });
      instGetter(proto, 'listener', function listener() { return null; });
      installEventTarget(proto); // addEventListener('complete')/oncomplete 路径(FingerprintJS2 主路径)
    };

    // ── OfflineAudioContext(可构造):(numberOfChannels, length, sampleRate) 或 (options);startRendering→Promise<AudioBuffer> ──
    const offState = new WeakMap();
    const offline = ctorIface('OfflineAudioContext', 1, (self, args) => {
      let numCh = 1, length = 0, sampleRate = 44100;
      if (args.length === 1 && args[0] && typeof args[0] === 'object') {
        ({ numberOfChannels: numCh = 1, length = 0, sampleRate = 44100 } = args[0]);
      } else { numCh = args[0] || 1; length = args[1] || 0; sampleRate = args[2] || 44100; }
      offState.set(self, { numCh, length, sampleRate });
    });
    installFactory(offline.proto, (self) => offState.get(self));
    mask.methods(offline.proto, {
      startRendering: [0, function startRendering() {
        const s = offState.get(this) || {};
        const buffer = makeBuffer(s.numCh, s.length, s.sampleRate);
        const self = this;
        // 真机渲染异步完成 → 既 resolve Promise<AudioBuffer>(现代),又触发 complete 事件 + oncomplete
        // (FingerprintJS2 等主流 audio 指纹走 oncomplete/addEventListener('complete') 路径,非 await)。
        const ev = mask.adopt(mask.tag({ type: 'complete', renderedBuffer: buffer }, 'OfflineAudioCompletionEvent'));
        window.Promise.resolve().then(() => fireEvent(self, 'complete', ev));
        return mask.promise(buffer);
      }],
      suspend: [1, function suspend() { return mask.promise(); }],
      resume: [0, function resume() { return mask.promise(); }],
    });
    instGetter(offline.proto, 'length', function length() { return (offState.get(this) || {}).length || 0; });
    instGetter(offline.proto, 'state', function state() { return 'suspended'; });

    // ── AudioContext(可构造,实时):close/suspend/resume → Promise ──
    const ctxState = new WeakMap();
    const audioCtx = ctorIface('AudioContext', 0, (self, [opts]) => {
      ctxState.set(self, { sampleRate: (opts && opts.sampleRate) || 44100 });
    });
    installFactory(audioCtx.proto, (self) => ctxState.get(self));
    mask.methods(audioCtx.proto, {
      close: [0, function close() { return mask.promise(); }],
      suspend: [0, function suspend() { return mask.promise(); }],
      resume: [0, function resume() { return mask.promise(); }],
    });
    instGetter(audioCtx.proto, 'state', function state() { return 'running'; });
    instGetter(audioCtx.proto, 'baseLatency', function baseLatency() { return 0; });

    // webkit 前缀别名(Chrome 保留;指纹常 `window.AudioContext || window.webkitAudioContext`)。
    Object.defineProperty(window, 'webkitAudioContext', { value: audioCtx.ctor, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(window, 'webkitOfflineAudioContext', { value: offline.ctor, writable: true, configurable: true, enumerable: false });
  },
};
