/**
 * patch/audio —— Web Audio 指纹壳(可构造 context + 节点链 + getChannelData 占位)。
 *
 * 根因:jsdom 无 Web Audio → 指纹脚本(`new OfflineAudioContext(...)` 起手)当场崩溃。
 * 范围:指纹触及的不崩调用链:OfflineAudioContext → createOscillator/Compressor/Gain →
 * connect → start → startRendering → getChannelData→Float32Array。
 *
 * 已知未尽项:getChannelData 返全 0 占位(跨实例相同);跳过 BaseAudioContext/EventTarget 中间继承层
 * (原型链深度有差);AudioParam/node 标量为实例 own(真机 prototype accessor)。
 */

export default {
  name: 'audio',
  after: [],
  apply({ window, mask }) {
    const WFloat32 = window.Float32Array;

    // 简易 EventTarget:装 context proto 自身(不继承 jsdom ETP,其 brand-check 对非 jsdom 实例抛)。
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
    // automationRate 真机[实测]'a-rate';此处统一(per-param k-rate 细分留长期)。
    mask.instAccessor(audioParam.proto, 'automationRate', function () { return 'a-rate'; });
    // value 为实例可写 own(真机 prototype accessor,见头注)。
    const makeParam = (defaultValue, minValue, maxValue) =>
      audioParam.create({ value: defaultValue, defaultValue, minValue, maxValue });

    // ── AudioNode 基类 + 子类(子类 proto 继承基类,connect/disconnect 住基类原型) ──
    // 拓扑标量(ni/no/cc/ccm/ci)真机[实测]为 AudioNode.prototype 访问器,值随节点类型异 → topoByProto 按类型存。
    const topoByProto = new Map(); // node proto → { ni, no, cc, ccm, ci }(真机实测,见各 nodeIface 调用)
    const nodeCtx = new WeakMap(); // node 实例 → 创建它的 context
    const mkNode = (n, ctx, props) => { const node = n.create(props); nodeCtx.set(node, ctx); return node; };
    const audioNode = mask.iface('AudioNode');
    mask.methods(audioNode.proto, {
      connect: [1, function connect(dest) { return dest; }], // 真机链式:返回被连 node
      disconnect: [0, function disconnect() {}],
    });
    const topo = (self) => topoByProto.get(Object.getPrototypeOf(self)) || {};
    mask.instAccessors(audioNode.proto, {
      numberOfInputs: function () { return topo(this).ni ?? 0; },
      numberOfOutputs: function () { return topo(this).no ?? 0; },
      channelCount: function () { return topo(this).cc ?? 2; },
      channelCountMode: function () { return topo(this).ccm || 'max'; },
      channelInterpretation: function () { return topo(this).ci || 'speakers'; },
      context: function () { return nodeCtx.get(this) || null; },
    });
    const nodeIface = (name, nodeTopo, methods) => {
      const n = mask.iface(name);
      Object.setPrototypeOf(n.proto, audioNode.proto); // extends AudioNode
      topoByProto.set(n.proto, nodeTopo);
      if (methods) mask.methods(n.proto, methods);
      return n;
    };
    const oscillatorNode = nodeIface('OscillatorNode', { ni: 0, no: 1, cc: 2, ccm: 'max', ci: 'speakers' }, {
      start: [1, function start() {}], stop: [1, function stop() {}], setPeriodicWave: [1, function setPeriodicWave() {}],
    });
    const dynamicsCompressorNode = nodeIface('DynamicsCompressorNode', { ni: 1, no: 1, cc: 2, ccm: 'clamped-max', ci: 'speakers' });
    const gainNode = nodeIface('GainNode', { ni: 1, no: 1, cc: 2, ccm: 'max', ci: 'speakers' });
    const analyserNode = nodeIface('AnalyserNode', { ni: 1, no: 1, cc: 2, ccm: 'max', ci: 'speakers' }, {
      getFloatFrequencyData: [1, function getFloatFrequencyData() {}],
      getByteFrequencyData: [1, function getByteFrequencyData() {}],
      getFloatTimeDomainData: [1, function getFloatTimeDomainData() {}],
      getByteTimeDomainData: [1, function getByteTimeDomainData() {}],
    });
    const bufferSourceNode = nodeIface('AudioBufferSourceNode', { ni: 0, no: 1, cc: 2, ccm: 'max', ci: 'speakers' }, {
      start: [1, function start() {}], stop: [1, function stop() {}],
    });
    const destinationNode = nodeIface('AudioDestinationNode', { ni: 1, no: 0, cc: 1, ccm: 'explicit', ci: 'speakers' });

    // ── AudioBuffer(可构造):getChannelData → 全 0 占位 Float32Array;length/sampleRate/... 读私有状态 ──
    const bufState = new WeakMap();
    const audioBuffer = mask.ctorIface('AudioBuffer', 1, (self, [opts]) => {
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
    mask.instAccessors(audioBuffer.proto, {
      length: function () { return (bufState.get(this) || {}).length || 0; },
      sampleRate: function () { return (bufState.get(this) || {}).sampleRate || 0; },
      numberOfChannels: function () { return (bufState.get(this) || {}).numCh || 0; },
      duration: function () { const s = bufState.get(this) || {}; return s.sampleRate ? (s.length || 0) / s.sampleRate : 0; },
    });

    // ── context 工厂方法(真机住 BaseAudioContext.prototype;此处装各 context proto,跳过中间层) ──
    const ctxDest = new WeakMap();
    const installFactory = (proto, stateOf) => {
      mask.methods(proto, {
        createOscillator: [0, function createOscillator() {
          return mkNode(oscillatorNode, this, { type: 'sine', frequency: makeParam(440, 0, 0), detune: makeParam(0, 0, 0) });
        }],
        createDynamicsCompressor: [0, function createDynamicsCompressor() {
          return mkNode(dynamicsCompressorNode, this, {
            threshold: makeParam(-24, -100, 0), knee: makeParam(30, 0, 40), ratio: makeParam(12, 1, 20),
            reduction: 0, attack: makeParam(0.003, 0, 1), release: makeParam(0.25, 0, 1),
          });
        }],
        createGain: [0, function createGain() { return mkNode(gainNode, this, { gain: makeParam(1, -3.4028234663852886e38, 3.4028234663852886e38) }); }],
        createAnalyser: [0, function createAnalyser() { return mkNode(analyserNode, this, { fftSize: 2048, frequencyBinCount: 1024 }); }],
        createBufferSource: [0, function createBufferSource() { return mkNode(bufferSourceNode, this, { buffer: null }); }],
        createBuffer: [3, function createBuffer(numCh, length, sampleRate) { return makeBuffer(numCh, length, sampleRate); }],
        decodeAudioData: [1, function decodeAudioData() { return mask.promise(makeBuffer(1, 0, 44100)); }],
      });
      mask.instAccessors(proto, {
        destination: function () {
          let d = ctxDest.get(this); if (!d) { d = mkNode(destinationNode, this, { maxChannelCount: 2 }); ctxDest.set(this, d); } return d;
        },
        sampleRate: function () { return (stateOf(this) || {}).sampleRate || 44100; },
        currentTime: function () { return 0; },
        listener: function () { return null; },
      });
      installEventTarget(proto); // addEventListener('complete')/oncomplete 路径(FingerprintJS2 主路径)
    };

    // ── OfflineAudioContext(可构造):(numberOfChannels, length, sampleRate) 或 (options);startRendering→Promise<AudioBuffer> ──
    const offState = new WeakMap();
    const offline = mask.ctorIface('OfflineAudioContext', 1, (self, args) => {
      let numCh = 1, length = 0, sampleRate = 44100;
      if (args.length === 1 && args[0] && typeof args[0] === 'object') {
        ({ numberOfChannels: numCh = 1, length = 0, sampleRate = 44100 } = args[0]);
      } else { numCh = args[0] || 1; length = args[1] || 0; sampleRate = args[2] || 44100; }
      offState.set(self, { numCh, length, sampleRate });
    });
    installFactory(offline.proto, (self) => offState.get(self));
    mask.eventHandler(offline.proto, 'oncomplete');
    mask.methods(offline.proto, {
      startRendering: [0, function startRendering() {
        const s = offState.get(this) || {};
        const buffer = makeBuffer(s.numCh, s.length, s.sampleRate);
        const self = this;
        // 对照 Blink FireCompletionEvent:派发前置 state='closed',oncomplete 内读到的 state 已是 'closed'。
        const ev = mask.adopt(mask.tag({ type: 'complete', renderedBuffer: buffer }, 'OfflineAudioCompletionEvent'));
        return window.Promise.resolve().then(() => {
          s.rendered = true;                  // state getter 据此返 'closed'(真机渲染后单向转换,offline 只能渲一次)
          fireEvent(self, 'complete', ev);
          return buffer;
        });
      }],
      suspend: [1, function suspend() { return mask.promise(); }],
      resume: [0, function resume() { return mask.promise(); }],
    });
    mask.instAccessors(offline.proto, {
      length: function () { return (offState.get(this) || {}).length || 0; },
      // [对照 Blink]:渲染前 'suspended',完成后单向转 'closed'。
      state: function () { return (offState.get(this) || {}).rendered ? 'closed' : 'suspended'; },
    });

    // ── AudioContext(可构造,实时):close/suspend/resume → Promise ──
    const ctxState = new WeakMap();
    const audioCtx = mask.ctorIface('AudioContext', 0, (self, [opts]) => {
      ctxState.set(self, { sampleRate: (opts && opts.sampleRate) || 44100 });
    });
    installFactory(audioCtx.proto, (self) => ctxState.get(self));
    mask.methods(audioCtx.proto, {
      close: [0, function close() { return mask.promise(); }],
      suspend: [0, function suspend() { return mask.promise(); }],
      resume: [0, function resume() { return mask.promise(); }],
    });
    mask.instAccessors(audioCtx.proto, {
      state: function () { return 'running'; },
      baseLatency: function () { return 0; },
    });

    // webkit 前缀别名(Chrome 保留)。
    Object.defineProperty(window, 'webkitAudioContext', { value: audioCtx.ctor, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(window, 'webkitOfflineAudioContext', { value: offline.ctor, writable: true, configurable: true, enumerable: false });
  },
};
