import { describeCoverage } from './capabilities.js';
import { legacyOrigin } from '../core/capabilities.js';
import type { AudioData, Bind, JsonValue } from '../core/types.js';
import type { DraftOp, Feature, Ref } from '../shape/types.js';
import { accessor, fn, fnShape, refProp, tag } from './ops.js';
import { FLOAT32 } from './audio.shared.js';
import { resolveAudioFingerprint } from '../environment/identity.js';
export { audioRound6 } from './audio.shared.js';

type Method = readonly [owner: string, name: string, length: number, op: string, kind?: string];

type Field = readonly [owner: string, name: string, writable: boolean, scope: string, field?: string];

/** BMS bO(39) seed 5381 — used by tests and offline checks. */
export function audioBo39(input: string, seed = 5381): string {
  let h = seed;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

/** Hash the BMS Vk() payload object (key order fixed). */
export function audioFingerprintHex(fp: AudioData): string {
  const payload = {
    reduction: fp.reduction,
    sampleSum: fp.sampleSum,
    freqSum: fp.freqSum,
    timeSum: fp.timeSum,
  };
  return audioBo39(JSON.stringify(payload));
}

const IFACES = [
  ['base', 'BaseAudioContext', { path: 'window.EventTarget.prototype' }, 0],
  ['offline', 'OfflineAudioContext', { node: 'audio.base.proto' }, 1],
  ['context', 'AudioContext', { node: 'audio.base.proto' }, 0],
  ['buffer', 'AudioBuffer', { path: 'window.Object.prototype' }, 1],
  ['node', 'AudioNode', { path: 'window.Object.prototype' }, 0],
  ['oscillator', 'OscillatorNode', { node: 'audio.node.proto' }, 0],
  ['compressor', 'DynamicsCompressorNode', { node: 'audio.node.proto' }, 0],
  ['gain', 'GainNode', { node: 'audio.node.proto' }, 0],
  ['analyser', 'AnalyserNode', { node: 'audio.node.proto' }, 0],
  ['source', 'AudioBufferSourceNode', { node: 'audio.node.proto' }, 0],
  ['destination', 'AudioDestinationNode', { node: 'audio.node.proto' }, 0],
  ['param', 'AudioParam', { path: 'window.Object.prototype' }, 0],
  ['complete', 'OfflineAudioCompletionEvent', { path: 'window.Event.prototype' }, 0],
] as const satisfies readonly (readonly [string, string, Ref, number])[];

const METHODS: readonly Method[] = [
  ['base', 'createOscillator', 0, 'factory', 'oscillator'],
  ['base', 'createDynamicsCompressor', 0, 'factory', 'compressor'],
  ['base', 'createGain', 0, 'factory', 'gain'],
  ['base', 'createAnalyser', 0, 'factory', 'analyser'],
  ['base', 'createBufferSource', 0, 'factory', 'source'],
  ['base', 'createBuffer', 3, 'create-buffer'],
  ['base', 'decodeAudioData', 1, 'decode'],
  ['base', 'addEventListener', 2, 'event-add'],
  ['base', 'removeEventListener', 2, 'event-remove'],
  ['base', 'dispatchEvent', 1, 'event-dispatch'],
  ['node', 'connect', 1, 'connect'],
  ['node', 'disconnect', 0, 'void-node'],
  ['oscillator', 'start', 1, 'void-node'],
  ['oscillator', 'stop', 1, 'void-node'],
  ['oscillator', 'setPeriodicWave', 1, 'void-node'],
  ['analyser', 'getFloatFrequencyData', 1, 'fill-float', 'freq'],
  ['analyser', 'getByteFrequencyData', 1, 'void-node'],
  ['analyser', 'getFloatTimeDomainData', 1, 'fill-float', 'time'],
  ['analyser', 'getByteTimeDomainData', 1, 'void-node'],
  ['source', 'start', 1, 'void-node'],
  ['source', 'stop', 1, 'void-node'],
  ['param', 'setValueAtTime', 2, 'param-chain'],
  ['param', 'linearRampToValueAtTime', 2, 'param-chain'],
  ['param', 'exponentialRampToValueAtTime', 2, 'param-chain'],
  ['param', 'setTargetAtTime', 3, 'param-chain'],
  ['param', 'setValueCurveAtTime', 3, 'param-chain'],
  ['param', 'cancelScheduledValues', 1, 'param-chain'],
  ['param', 'cancelAndHoldAtTime', 1, 'param-chain'],
  ['buffer', 'getChannelData', 1, 'channel'],
  ['buffer', 'copyFromChannel', 3, 'void-buffer'],
  ['buffer', 'copyToChannel', 3, 'void-buffer'],
  ['offline', 'startRendering', 0, 'render'],
  ['offline', 'suspend', 1, 'offline-suspend'],
  ['offline', 'resume', 0, 'offline-resume'],
  ['context', 'close', 0, 'context-close'],
  ['context', 'suspend', 0, 'context-suspend'],
  ['context', 'resume', 0, 'context-resume'],
];

const FIELDS: readonly Field[] = [
  ['base', 'destination', false, 'context'],
  ['base', 'sampleRate', false, 'context'],
  ['base', 'currentTime', false, 'context'],
  ['base', 'listener', false, 'context'],
  ['offline', 'length', false, 'context'],
  ['offline', 'state', false, 'context'],
  ['offline', 'oncomplete', true, 'handler'],
  ['context', 'state', false, 'context'],
  ['context', 'baseLatency', false, 'context'],
  ['node', 'numberOfInputs', false, 'node'],
  ['node', 'numberOfOutputs', false, 'node'],
  ['node', 'channelCount', true, 'node'],
  ['node', 'channelCountMode', true, 'node'],
  ['node', 'channelInterpretation', true, 'node'],
  ['node', 'context', false, 'node'],
  ['oscillator', 'type', true, 'node'],
  ['oscillator', 'frequency', false, 'node-param', 'frequency'],
  ['oscillator', 'detune', false, 'node-param', 'detune'],
  ['compressor', 'threshold', false, 'node-param', 'threshold'],
  ['compressor', 'knee', false, 'node-param', 'knee'],
  ['compressor', 'ratio', false, 'node-param', 'ratio'],
  ['compressor', 'reduction', false, 'node'],
  ['compressor', 'attack', false, 'node-param', 'attack'],
  ['compressor', 'release', false, 'node-param', 'release'],
  ['gain', 'gain', false, 'node-param', 'gain'],
  ['analyser', 'fftSize', true, 'node'],
  ['analyser', 'frequencyBinCount', false, 'node'],
  ['source', 'buffer', true, 'node'],
  ['source', 'playbackRate', false, 'node-param', 'playbackRate'],
  ['source', 'detune', false, 'node-param', 'detune'],
  ['source', 'loop', true, 'node'],
  ['destination', 'maxChannelCount', false, 'node'],
  ['param', 'value', true, 'param'],
  ['param', 'defaultValue', false, 'param'],
  ['param', 'minValue', false, 'param'],
  ['param', 'maxValue', false, 'param'],
  ['param', 'automationRate', true, 'param'],
  ['buffer', 'length', false, 'buffer'],
  ['buffer', 'sampleRate', false, 'buffer'],
  ['buffer', 'numberOfChannels', false, 'buffer'],
  ['buffer', 'duration', false, 'buffer'],
  ['complete', 'type', false, 'event'],
  ['complete', 'renderedBuffer', false, 'event'],
];

const proto = (id: string): Ref => ({ node: `audio.${id}.proto` });
const slot = (owner: string, name: string, part?: 'get' | 'set'): string => (
  `audio.${owner}.${name}${part ? `.${part}` : ''}`
);

export function operations(): DraftOp[] {
  const ops: DraftOp[] = [];
  const keys = new Map<string, string[]>(IFACES.map(([id]) => [id, []]));
  for (const [id, name, parent, length] of IFACES) {
    ops.push(
      { op: 'alloc', id: `audio.${id}.proto`, kind: 'object' },
      {
        op: 'alloc', id: `audio.${id}.ctor`, kind: 'function', slot: `audio.${id}.ctor`,
        shape: fnShape(name, length, true, true), prototype: proto(id),
      },
      { op: 'proto', target: proto(id), value: parent },
      refProp({ path: 'window' }, name, `audio.${id}.ctor`),
      refProp(proto(id), 'constructor', `audio.${id}.ctor`),
      tag(proto(id), name),
    );
  }
  ops.push(
    refProp({ path: 'window' }, 'webkitAudioContext', 'audio.context.ctor'),
    refProp({ path: 'window' }, 'webkitOfflineAudioContext', 'audio.offline.ctor'),
  );
  for (const [owner, name, length] of METHODS) {
    const id = slot(owner, name);
    ops.push(fn(id, id, name, length), refProp(proto(owner), name, id, true));
    keys.get(owner)!.push(name);
  }
  for (const [owner, name, writable] of FIELDS) {
    const get = slot(owner, name, 'get');
    const set = writable ? slot(owner, name, 'set') : undefined;
    ops.push(fn(get, get, `get ${name}`), ...(set ? [fn(set, set, `set ${name}`, 1)] : []), accessor(proto(owner), name, get, set));
    keys.get(owner)!.push(name);
  }
  for (const [id] of IFACES) {
    ops.push({
      op: 'order', target: proto(id),
      keys: [...keys.get(id)!, 'constructor', { symbol: 'toStringTag' }],
    });
  }
  return ops;
}

function fingerprintJson(fp: AudioData): JsonValue {
  return {
    reduction: fp.reduction,
    sampleSum: fp.sampleSum,
    freqSum: fp.freqSum,
    timeSum: fp.timeSum,
  };
}

function binds(fp: AudioData): Bind[] {
  const fingerprint = fingerprintJson(fp);
  const output: Bind[] = IFACES.map(([id, name]) => ({
    slot: `audio.${id}.ctor`, driver: 'audio',
    config: id === 'offline' || id === 'context'
      ? { op: 'context-ctor', kind: id, proto: `audio.${id}.proto`, name, fingerprint }
      : id === 'buffer'
        ? { op: 'buffer-ctor', proto: 'audio.buffer.proto', name, fingerprint }
        : { op: 'illegal', name, fingerprint },
  }));
  for (const [owner, name, _length, op, kind] of METHODS) {
    output.push({
      slot: slot(owner, name), driver: 'audio',
      config: { op, ...(kind ? { kind } : {}), fingerprint },
      ...(op === 'channel' ? { sources: [FLOAT32] } : {}),
    });
  }
  for (const [owner, name, writable, scope, field = name] of FIELDS) {
    output.push({
      slot: slot(owner, name, 'get'), driver: 'audio',
      config: { op: 'get', scope, field, fingerprint },
    });
    if (writable) {
      output.push({
        slot: slot(owner, name, 'set'), driver: 'audio',
        config: { op: 'set', scope, field, fingerprint },
      });
    }
  }
  return output;
}

export const audioFeature: Feature = {
  id: 'audio',
  jobKeys: [],
  describe: ({ profile }, support) => describeCoverage(support, {
    'audio.samples': 'constant',
    'audio.fingerprint': 'none',
    'audio.runtime': 'partial',
    'audio.render': 'constant',
    'audio.events': 'partial',
    'audio.sums': 'constant',
    'audio.data': 'constant',
  }, {
    'audio.samples': 'synthetic',
    'audio.sums': profile.audio ? legacyOrigin(profile.evidence.audio.support) : 'synthetic',
    'audio.data': profile.audio ? legacyOrigin(profile.evidence.audio.support) : 'synthetic',
  }),
  rev: '2',
  requires: ['dom'],
  build: ({ profile }) => {
    const fp = resolveAudioFingerprint(profile);
    const fromProfile = profile.audio !== undefined;
    return {
      binds: binds(fp),
      support: {
        // Keep audio.samples / audio.fingerprint on the Shape (shape-only / unsupported)
        // so baked shapes do not WRITE_CONFLICT. Announce 4-tuple fidelity here.
        'audio.runtime': 'emulated',
        'audio.render': 'emulated',
        'audio.events': 'emulated',
        'audio.sums': fromProfile ? 'captured' : 'derived',
        'audio.data': fromProfile ? profile.evidence.audio.support : 'derived',
      },
    };
  },
};
