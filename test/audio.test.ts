import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  Catalog, compile, JsdomEngine, LegacyProfiles, parseJob,
} from '../src/index.js';
import {
  audioBo39,
  audioFingerprintHex,
  synthesizeAudioFingerprint,
} from '../src/features/audio.js';
import { drivers, features } from '../src/features/index.js';

const store = new LegacyProfiles(path.resolve('profiles'));

/** Use baked shape + full feature set (production path). Rebuilds via audioShape hit chrome/dom WRITE_CONFLICT on hasPrivateToken. */
async function open(id: string) {
  const imported = await store.load(id);
  const engine = new JsdomEngine();
  const plan = compile({
    profile: imported.profile,
    catalog: Catalog.create('builtin', [imported.shape], features),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: Object.keys(drivers),
  });
  return { engine, plan, runtime: engine.open(plan, drivers) };
}

test('audio runs the OfflineAudioContext fingerprint chain with Realm return values', async () => {
  const { engine, plan, runtime } = await open('macos-chrome-v148');
  try {
    assert.equal(plan.support['audio.samples'], 'shape-only');
    assert.equal(plan.support['audio.fingerprint'], 'unsupported');
    assert.equal(plan.support['audio.sums'], 'derived');
    const result = runtime.run(`(async () => {
      const context = new OfflineAudioContext(1, 44100, 44100);
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 10000;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-50, context.currentTime);
      const gain = context.createGain();
      const connected = oscillator.connect(compressor);
      compressor.connect(gain); gain.connect(context.destination);
      oscillator.start(0);
      const rendering = context.startRendering();
      const buffer = await rendering;
      const data = buffer.getChannelData(0);
      return JSON.stringify({
        contexts: [
          typeof OfflineAudioContext,
          context instanceof OfflineAudioContext,
          Object.prototype.toString.call(context),
        ],
        nodes: [
          oscillator instanceof OscillatorNode,
          oscillator instanceof AudioNode,
          compressor instanceof DynamicsCompressorNode,
          gain instanceof GainNode,
          context.destination instanceof AudioDestinationNode,
        ],
        params: [oscillator.frequency instanceof AudioParam, oscillator.frequency.value, compressor.threshold instanceof AudioParam],
        connected: connected === compressor,
        rendering: rendering instanceof Promise,
        buffer: [
          buffer instanceof AudioBuffer,
          buffer.length,
          buffer.sampleRate,
          buffer.numberOfChannels,
          buffer.duration,
        ],
        data: [data instanceof Float32Array, data.length],
        native: [buffer.getChannelData.toString(), context.createOscillator.toString()],
        aliases: [webkitAudioContext === AudioContext, webkitOfflineAudioContext === OfflineAudioContext],
      });
    })()`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(await result.value));
    assert.deepEqual(value, {
      contexts: ['function', true, '[object OfflineAudioContext]'],
      nodes: [true, true, true, true, true],
      params: [true, 10000, true],
      connected: true,
      rendering: true,
      buffer: [true, 44100, 44100, 1, 1],
      data: [true, 44100],
      native: [
        'function getChannelData() { [native code] }',
        'function createOscillator() { [native code] }',
      ],
      aliases: [true, true],
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('audio fires the OfflineAudioContext completion handler and EventTarget listener', async () => {
  const { engine, runtime } = await open('macos-chrome-v148');
  try {
    const result = runtime.run(`(async () => {
      const context = new OfflineAudioContext(1, 16, 8000);
      const initial = [context.oncomplete, Object.hasOwn(context, 'oncomplete')];
      let handler = null;
      let listener = null;
      context.oncomplete = event => {
        handler = [
          event instanceof OfflineAudioCompletionEvent,
          event instanceof Event,
          event.renderedBuffer instanceof AudioBuffer,
          event.type,
          context.state,
          Object.prototype.toString.call(event),
        ];
      };
      context.addEventListener('complete', event => {
        listener = [event.renderedBuffer.length, event.renderedBuffer.sampleRate];
      });
      const ownAfter = Object.hasOwn(context, 'oncomplete');
      const descriptor = Object.getOwnPropertyDescriptor(OfflineAudioContext.prototype, 'oncomplete');
      const buffer = await context.startRendering();
      await Promise.resolve();
      return JSON.stringify({
        eventTarget: context instanceof EventTarget,
        initial,
        ownAfter,
        accessor: [typeof descriptor.get, typeof descriptor.set],
        handler,
        listener,
        state: context.state,
        sameBuffer: handler[2] && buffer.length === listener[0],
        native: context.addEventListener.toString(),
      });
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(await result.value)), {
      eventTarget: true,
      initial: [null, false],
      ownAfter: false,
      accessor: ['function', 'function'],
      handler: [true, true, true, 'complete', 'closed', '[object OfflineAudioCompletionEvent]'],
      listener: [16, 8000],
      state: 'closed',
      sameBuffer: true,
      native: 'function addEventListener() { [native code] }',
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('audio exposes realtime state promises and the complete AudioNode factory topology', async () => {
  const { engine, runtime } = await open('macos-chrome-v148');
  try {
    const result = runtime.run(`(async () => {
      const context = new AudioContext({ sampleRate: 48000 });
      const oscillator = context.createOscillator();
      const compressor = context.createDynamicsCompressor();
      const gain = context.createGain();
      const analyser = context.createAnalyser();
      const source = context.createBufferSource();
      const destination = context.destination;
      const buffer = context.createBuffer(2, 32, 48000);
      source.buffer = buffer;
      analyser.fftSize = 4096;
      gain.gain.value = 0.5;
      const scheduled = oscillator.frequency.linearRampToValueAtTime(880, 1);
      const suspended = context.suspend();
      const stateAfterSuspend = context.state;
      await suspended;
      const resumed = context.resume();
      const stateAfterResume = context.state;
      await resumed;
      const closed = context.close();
      const stateAfterClose = context.state;
      await closed;
      const decoded = context.decodeAudioData(new ArrayBuffer(0));
      const decodedBuffer = await decoded;
      return JSON.stringify({
        context: [
          context instanceof AudioContext,
          Object.prototype.toString.call(context),
          context.sampleRate,
          context.baseLatency,
        ],
        promises: [suspended, resumed, closed, decoded].map(value => value instanceof Promise),
        states: [stateAfterSuspend, stateAfterResume, stateAfterClose],
        classes: [
          oscillator instanceof OscillatorNode,
          compressor instanceof DynamicsCompressorNode,
          gain instanceof GainNode,
          analyser instanceof AnalyserNode,
          source instanceof AudioBufferSourceNode,
          destination instanceof AudioDestinationNode,
        ],
        topology: [
          oscillator.numberOfInputs, oscillator.numberOfOutputs,
          oscillator.channelCountMode, oscillator.channelInterpretation,
          compressor.channelCountMode, destination.numberOfOutputs, destination.maxChannelCount,
          oscillator.context === context,
          !Object.hasOwn(oscillator, 'numberOfInputs'),
        ],
        params: [
          oscillator.frequency === oscillator.frequency,
          oscillator.frequency.automationRate,
          scheduled === oscillator.frequency,
          gain.gain.value,
        ],
        analyser: [analyser.fftSize, analyser.frequencyBinCount],
        source: [source.buffer === buffer, source.playbackRate instanceof AudioParam, source.detune instanceof AudioParam],
        decoded: [decodedBuffer instanceof AudioBuffer, decodedBuffer.length, decodedBuffer.sampleRate],
      });
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(await result.value)), {
      context: [true, '[object AudioContext]', 48000, 0],
      promises: [true, true, true, true],
      states: ['suspended', 'running', 'closed'],
      classes: [true, true, true, true, true, true],
      topology: [0, 1, 'max', 'speakers', 'clamped-max', 0, 2, true, true],
      params: [true, 'a-rate', true, 0.5],
      analyser: [4096, 2048],
      source: [true, true, true],
      decoded: [true, 0, 44100],
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('audio preserves native function shapes, prototype order, and WebIDL constructor errors', async () => {
  const { engine, runtime } = await open('macos-chrome-v148');
  try {
    const result = runtime.run(`(() => {
      const context = new OfflineAudioContext(1, 8, 8000);
      const oscillator = context.createOscillator();
      oscillator.frequency.value = '2.5';
      const failure = fn => { try { fn(); return null; } catch (error) { return [error instanceof TypeError, error.message]; } };
      const tell = fn => [fn.name, fn.length, fn.toString(), Object.hasOwn(fn, 'prototype'), Reflect.ownKeys(fn).map(String)];
      const numberOfInputs = Object.getOwnPropertyDescriptor(AudioNode.prototype, 'numberOfInputs').get;
      return JSON.stringify({
        constructors: [
          tell(OfflineAudioContext), tell(AudioContext), tell(AudioBuffer), tell(OscillatorNode),
        ],
        methods: [
          tell(context.createOscillator), tell(AudioNode.prototype.connect), tell(AudioParam.prototype.setValueAtTime),
          tell(AudioBuffer.prototype.getChannelData), tell(numberOfInputs),
        ],
        orders: [OfflineAudioContext.prototype, OscillatorNode.prototype, AudioParam.prototype, AudioNode.prototype]
          .map(proto => Object.getOwnPropertyNames(proto).at(-1)),
        hierarchy: [
          Object.getPrototypeOf(OfflineAudioContext.prototype) === BaseAudioContext.prototype,
          Object.getPrototypeOf(BaseAudioContext.prototype) === EventTarget.prototype,
          Object.getPrototypeOf(OscillatorNode.prototype) === AudioNode.prototype,
        ],
        converted: [oscillator.frequency.value, typeof oscillator.frequency.value],
        failures: [
          failure(() => OfflineAudioContext(1, 1, 1)),
          failure(() => AudioContext()),
          failure(() => AudioBuffer({ length: 1, sampleRate: 8000 })),
          failure(() => new AudioNode()),
          failure(() => new AudioParam()),
        ],
      });
    })()`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    assert.deepEqual(value.constructors.map((item: unknown[]) => item.slice(0, 2)), [
      ['OfflineAudioContext', 1], ['AudioContext', 0], ['AudioBuffer', 1], ['OscillatorNode', 0],
    ]);
    for (const item of [...value.constructors, ...value.methods]) {
      assert.match(item[2], /^function (?:get )?\w+\(\) \{ \[native code\] \}$/);
    }
    for (const item of value.methods) {
      assert.equal(item[3], false);
      assert.deepEqual(item[4], ['length', 'name']);
    }
    assert.deepEqual(value.methods.map((item: unknown[]) => item.slice(0, 2)), [
      ['createOscillator', 0], ['connect', 1], ['setValueAtTime', 2], ['getChannelData', 1], ['get numberOfInputs', 0],
    ]);
    assert.deepEqual(value.orders, ['constructor', 'constructor', 'constructor', 'constructor']);
    assert.deepEqual(value.hierarchy, [true, true, true]);
    assert.deepEqual(value.converted, [2.5, 'number']);
    assert.deepEqual(value.failures, [
      [true, "Failed to construct 'OfflineAudioContext': Please use the 'new' operator, this DOM object constructor cannot be called as a function."],
      [true, "Failed to construct 'AudioContext': Please use the 'new' operator, this DOM object constructor cannot be called as a function."],
      [true, "Failed to construct 'AudioBuffer': Please use the 'new' operator, this DOM object constructor cannot be called as a function."],
      [true, "Failed to construct 'AudioNode': Illegal constructor"],
      [true, "Failed to construct 'AudioParam': Illegal constructor"],
    ]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('audio dispatchEvent composes oncomplete with removable EventTarget listeners', async () => {
  const { engine, runtime } = await open('macos-chrome-v148');
  try {
    const result = runtime.run(`(() => {
      const context = new OfflineAudioContext(1, 1, 8000);
      let handled = 0;
      let listened = 0;
      const listener = () => listened++;
      context.oncomplete = () => handled++;
      context.addEventListener('complete', listener);
      const first = context.dispatchEvent(new Event('complete'));
      context.removeEventListener('complete', listener);
      const second = context.dispatchEvent(new Event('complete'));
      return JSON.stringify({ first, second, handled, listened });
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(String(result.value)), {
      first: true,
      second: true,
      handled: 2,
      listened: 1,
    });
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('audio fingerprint leaves the all-zero bO(39) cluster and is stable per profile id', () => {
  const zero = audioFingerprintHex({ reduction: 0, sampleSum: 0, freqSum: 0, timeSum: 0 });
  assert.equal(zero, '85eefa4e');

  const a = synthesizeAudioFingerprint('android-chrome/a');
  const b = synthesizeAudioFingerprint('android-chrome/b');
  assert.notDeepEqual(a, b);
  const ha = audioFingerprintHex(a);
  const hb = audioFingerprintHex(b);
  assert.notEqual(ha, '85eefa4e');
  assert.notEqual(hb, '85eefa4e');
  assert.notEqual(ha, hb);
  assert.equal(audioFingerprintHex(synthesizeAudioFingerprint('android-chrome/a')), ha);
});

test('audio Offline chain fills BMS-style sums from synthetic fingerprint', async () => {
  const { engine, plan, runtime } = await open('macos-chrome-v148');
  // No profile.audio → feature synthesizes from profile.id
  const expected = synthesizeAudioFingerprint(plan.profile.id);
  const expectedHex = audioFingerprintHex(expected);
  assert.notEqual(expectedHex, '85eefa4e');
  assert.equal(plan.support['audio.sums'], 'derived');

  try {
    const result = runtime.run(`(async () => {
      const context = new OfflineAudioContext(1, 5000, 44100);
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 10000;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -50;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0;
      compressor.release.value = 0.25;
      oscillator.connect(compressor);
      compressor.connect(context.destination);
      oscillator.start(0);
      const buffer = await context.startRendering();
      const channel = buffer.getChannelData(0);
      const sampleSum = +channel.reduce((a, b) => a + b, 0).toFixed(6);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      source.start();
      const freq = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(freq);
      const freqSum = +freq.reduce((a, b) => a + b, 0).toFixed(6);
      const time = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(time);
      const timeSum = +time.reduce((a, b) => a + b, 0).toFixed(6);
      const reduction = +compressor.reduction.toFixed(6);
      const payload = { reduction, sampleSum, freqSum, timeSum };
      return JSON.stringify(payload);
    })()`);
    assert.equal(result.ok, true, result.ok ? '' : String(result.error));
    const payload = JSON.parse(String(await result.value));
    assert.deepEqual(payload, {
      reduction: expected.reduction,
      sampleSum: expected.sampleSum,
      freqSum: expected.freqSum,
      timeSum: expected.timeSum,
    });
    assert.equal(audioBo39(JSON.stringify(payload)), expectedHex);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('audio fingerprint differs across profiles', async () => {
  const first = await open('macos-chrome-v148');
  const second = await open('linux-chrome');
  try {
    const a = synthesizeAudioFingerprint(first.plan.profile.id);
    const b = synthesizeAudioFingerprint(second.plan.profile.id);
    assert.notEqual(audioFingerprintHex(a), audioFingerprintHex(b));
    assert.notEqual(audioFingerprintHex(a), '85eefa4e');
  } finally {
    first.runtime.dispose();
    second.runtime.dispose();
  }
});
