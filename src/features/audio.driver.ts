import type { AudioData, JsonValue } from '../core/types.js';
import type { Driver, Port } from '../engine/types.js';
import { audioRound6, asFloat32, FLOAT32 } from './audio.shared.js';

interface Config {
  op: string;
  kind?: string;
  proto?: string;
  name?: string;
  scope?: string;
  field?: string;
  fingerprint?: AudioData;
}

interface ContextState {
  kind: 'offline' | 'context';
  channels: number;
  length: number;
  sampleRate: number;
  state: 'running' | 'suspended' | 'closed';
  destination?: object;
}

interface NodeState {
  kind: string;
  context: object;
  fields: Map<string, unknown>;
  params: Map<string, object>;
}

interface ParamState {
  value: number;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  automationRate: string;
}

interface BufferState {
  channels: number;
  length: number;
  sampleRate: number;
  data: Map<number, object>;
}

interface EventState {
  type: string;
  renderedBuffer: object;
}

const TOPOLOGY: Readonly<Record<string, readonly [number, number, number, string, string]>> = {
  oscillator: [0, 1, 2, 'max', 'speakers'],
  compressor: [1, 1, 2, 'clamped-max', 'speakers'],
  gain: [1, 1, 2, 'max', 'speakers'],
  analyser: [1, 1, 2, 'max', 'speakers'],
  source: [0, 1, 2, 'max', 'speakers'],
  destination: [1, 0, 1, 'explicit', 'speakers'],
};

const PARAMS: Readonly<Record<string, Readonly<Record<string, readonly [number, number, number]>>>> = {
  oscillator: { frequency: [440, 0, 3.4028234663852886e38], detune: [0, -3.4028234663852886e38, 3.4028234663852886e38] },
  compressor: {
    threshold: [-24, -100, 0], knee: [30, 0, 40], ratio: [12, 1, 20],
    attack: [0.003, 0, 1], release: [0.25, 0, 1],
  },
  gain: { gain: [1, -3.4028234663852886e38, 3.4028234663852886e38] },
  source: {
    playbackRate: [1, -3.4028234663852886e38, 3.4028234663852886e38],
    detune: [0, -3.4028234663852886e38, 3.4028234663852886e38],
  },
};

function readFingerprint(value: JsonValue | undefined): AudioData | undefined {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') return undefined;
  const raw = value.fingerprint;
  if (raw === null || raw === undefined || Array.isArray(raw) || typeof raw !== 'object') return undefined;
  const reduction = Number(Reflect.get(raw, 'reduction'));
  const sampleSum = Number(Reflect.get(raw, 'sampleSum'));
  const freqSum = Number(Reflect.get(raw, 'freqSum'));
  const timeSum = Number(Reflect.get(raw, 'timeSum'));
  if (![reduction, sampleSum, freqSum, timeSum].every(Number.isFinite)) return undefined;
  return {
    reduction: audioRound6(reduction),
    sampleSum: audioRound6(sampleSum),
    freqSum: audioRound6(freqSum),
    timeSum: audioRound6(timeSum),
  };
}

function config(value: JsonValue | undefined): Config {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || typeof value.op !== 'string') {
    throw new TypeError('audio Driver config invalid');
  }
  const fingerprint = readFingerprint(value);
  return {
    op: value.op,
    ...(typeof value.kind === 'string' ? { kind: value.kind } : {}),
    ...(typeof value.proto === 'string' ? { proto: value.proto } : {}),
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.scope === 'string' ? { scope: value.scope } : {}),
    ...(typeof value.field === 'string' ? { field: value.field } : {}),
    ...(fingerprint ? { fingerprint } : {}),
  };
}

/**
 * Write sum into index 0 so array.reduce((a,b)=>a+b,0) equals sum (BMS Vk).
 * Uses float32 truncation when the target is a Float32Array (channel / analyser buffers).
 */
function fillSum(target: object, length: number, sum: number): void {
  const value = ArrayBuffer.isView(target) && target instanceof Float32Array
    ? asFloat32(sum)
    : sum;
  for (let i = 0; i < length; i += 1) {
    Reflect.set(target, i, i === 0 ? value : 0);
  }
}

function object(port: Port, value: unknown): object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw port.error('TypeError', 'Illegal invocation');
  }
  return value;
}

function number(value: unknown, fallback: number): number {
  const output = Number(value);
  return Number.isFinite(output) ? output : fallback;
}

export const audioDriver: Driver = {
  open: (port) => {
    const contexts = new WeakMap<object, ContextState>();
    const nodes = new WeakMap<object, NodeState>();
    const params = new WeakMap<object, ParamState>();
    const buffers = new WeakMap<object, BufferState>();
    const events = new WeakMap<object, EventState>();
    const handlers = new WeakMap<object, unknown>();
    const listeners = new WeakMap<object, Map<string, Set<unknown>>>();
    const float32 = port.source(FLOAT32);
    if (typeof float32 !== 'function') throw new TypeError('audio Float32Array source is not callable');

    const made = (id: string): object => object(port, port.make(id));
    const context = (value: unknown): [object, ContextState] => {
      const target = object(port, value);
      const state = contexts.get(target);
      if (!state) throw port.error('TypeError', 'Illegal invocation');
      return [target, state];
    };
    const node = (value: unknown): [object, NodeState] => {
      const target = object(port, value);
      const state = nodes.get(target);
      if (!state) throw port.error('TypeError', 'Illegal invocation');
      return [target, state];
    };
    const param = (value: unknown): [object, ParamState] => {
      const target = object(port, value);
      const state = params.get(target);
      if (!state) throw port.error('TypeError', 'Illegal invocation');
      return [target, state];
    };
    const buffer = (value: unknown): [object, BufferState] => {
      const target = object(port, value);
      const state = buffers.get(target);
      if (!state) throw port.error('TypeError', 'Illegal invocation');
      return [target, state];
    };
    const makeParam = (spec: readonly [number, number, number]): object => {
      const target = made('audio.param.proto');
      params.set(target, {
        value: spec[0], defaultValue: spec[0], minValue: spec[1], maxValue: spec[2], automationRate: 'a-rate',
      });
      return target;
    };
    const makeNode = (kind: string, owner: object): object => {
      const target = made(`audio.${kind}.proto`);
      const fields = new Map<string, unknown>();
      if (kind === 'oscillator') fields.set('type', 'sine');
      if (kind === 'compressor') fields.set('reduction', 0);
      if (kind === 'analyser') { fields.set('fftSize', 2048); fields.set('frequencyBinCount', 1024); }
      if (kind === 'source') { fields.set('buffer', null); fields.set('loop', false); }
      if (kind === 'destination') fields.set('maxChannelCount', 2);
      nodes.set(target, { kind, context: owner, fields, params: new Map() });
      return target;
    };
    const makeBuffer = (channels: unknown, length: unknown, sampleRate: unknown): object => {
      const target = made('audio.buffer.proto');
      buffers.set(target, {
        channels: Math.max(1, Math.trunc(number(channels, 1))),
        length: Math.max(0, Math.trunc(number(length, 0))),
        sampleRate: number(sampleRate, 44100),
        data: new Map(),
      });
      return target;
    };
    const resolved = (value?: object): Promise<unknown> => {
      const promise = port.resolve();
      return value === undefined ? promise : promise.then(() => value);
    };
    const fire = (owner: object, type: string, event: object): void => {
      for (const callback of listeners.get(owner)?.get(type) ?? []) {
        if (typeof callback === 'function') {
          try { Reflect.apply(callback, owner, [event]); } catch { /* event callbacks do not alter audio state */ }
        }
      }
      if (type === 'complete') {
        const handler = handlers.get(owner);
        if (typeof handler === 'function') {
          try { Reflect.apply(handler, owner, [event]); } catch { /* event callbacks do not alter audio state */ }
        }
      }
    };
    const noNew = (name: string): Error => port.error(
      'TypeError',
      `Failed to construct '${name}': Please use the 'new' operator, this DOM object constructor cannot be called as a function.`,
    );

    const get = (item: Config, self: unknown): unknown => {
      const field = String(item.field);
      if (item.scope === 'context') {
        const [owner, state] = context(self);
        if (field === 'destination') return state.destination ??= makeNode('destination', owner);
        if (field === 'sampleRate') return state.sampleRate;
        if (field === 'currentTime') return 0;
        if (field === 'listener') return null;
        if (field === 'length') return state.length;
        if (field === 'state') return state.state;
        if (field === 'baseLatency') return 0;
      }
      if (item.scope === 'node' || item.scope === 'node-param') {
        const [_target, state] = node(self);
        if (item.scope === 'node-param') {
          let value = state.params.get(field);
          if (!value) {
            const spec = PARAMS[state.kind]?.[field] ?? [0, -3.4028234663852886e38, 3.4028234663852886e38];
            value = makeParam(spec);
            state.params.set(field, value);
          }
          return value;
        }
        const topology = TOPOLOGY[state.kind] ?? [0, 0, 2, 'max', 'speakers'];
        if (field === 'numberOfInputs') return topology[0];
        if (field === 'numberOfOutputs') return topology[1];
        if (field === 'channelCount') return state.fields.get(field) ?? topology[2];
        if (field === 'channelCountMode') return state.fields.get(field) ?? topology[3];
        if (field === 'channelInterpretation') return state.fields.get(field) ?? topology[4];
        if (field === 'context') return state.context;
        if (field === 'reduction' && state.kind === 'compressor' && item.fingerprint) {
          return item.fingerprint.reduction;
        }
        return state.fields.get(field);
      }
      if (item.scope === 'param') return param(self)[1][field as keyof ParamState];
      if (item.scope === 'buffer') {
        const state = buffer(self)[1];
        if (field === 'numberOfChannels') return state.channels;
        if (field === 'duration') return state.sampleRate ? state.length / state.sampleRate : 0;
        return state[field as 'length' | 'sampleRate'];
      }
      if (item.scope === 'handler') return handlers.get(object(port, self)) ?? null;
      if (item.scope === 'event') {
        const state = events.get(object(port, self));
        if (!state) throw port.error('TypeError', 'Illegal invocation');
        return state[field as keyof EventState];
      }
      throw new TypeError(`audio getter invalid:${String(item.scope)}.${field}`);
    };

    return {
      call: (raw, self, args) => {
        const item = config(raw);
        if (item.op === 'context-ctor' || item.op === 'buffer-ctor') throw noNew(String(item.name));
        if (item.op === 'illegal') {
          throw port.error('TypeError', `Failed to construct '${String(item.name)}': Illegal constructor`);
        }
        if (item.op === 'factory') return makeNode(String(item.kind), context(self)[0]);
        if (item.op === 'create-buffer') {
          context(self);
          return makeBuffer(args[0], args[1], args[2]);
        }
        if (item.op === 'decode') {
          context(self);
          return resolved(makeBuffer(1, 0, 44100));
        }
        if (item.op === 'connect') { node(self); return args[0]; }
        if (item.op === 'void-node') { node(self); return undefined; }
        if (item.op === 'fill-float') {
          node(self);
          const target = args[0];
          if (target !== null && target !== undefined && (typeof target === 'object' || typeof target === 'function')) {
            const length = Math.max(0, Math.trunc(number(Reflect.get(target, 'length'), 0)));
            const fp = item.fingerprint;
            const sum = fp
              ? (item.kind === 'freq' ? fp.freqSum : item.kind === 'time' ? fp.timeSum : 0)
              : 0;
            fillSum(object(port, target), length, sum);
          }
          return undefined;
        }
        if (item.op === 'param-chain') { param(self); return self; }
        if (item.op === 'void-buffer') { buffer(self); return undefined; }
        if (item.op === 'channel') {
          const [_target, state] = buffer(self);
          const channel = Math.trunc(number(args[0], -1));
          if (channel < 0 || channel >= state.channels) throw port.error('RangeError', 'channel index is out of range');
          let data = state.data.get(channel);
          if (!data) {
            data = object(port, Reflect.construct(float32, [state.length]));
            if (item.fingerprint && state.length > 0) {
              fillSum(data, state.length, item.fingerprint.sampleSum);
            }
            state.data.set(channel, data);
          }
          return data;
        }
        if (item.op === 'render') {
          const [owner, state] = context(self);
          if (state.kind !== 'offline') throw port.error('TypeError', 'Illegal invocation');
          const value = makeBuffer(state.channels, state.length, state.sampleRate);
          return resolved(value).then(() => {
            state.state = 'closed';
            const event = made('audio.complete.proto');
            events.set(event, { type: 'complete', renderedBuffer: value });
            fire(owner, 'complete', event);
            return value;
          });
        }
        if (item.op === 'offline-suspend' || item.op === 'offline-resume') { context(self); return resolved(); }
        if (item.op === 'context-close' || item.op === 'context-suspend' || item.op === 'context-resume') {
          const state = context(self)[1];
          state.state = item.op === 'context-close' ? 'closed' : item.op === 'context-suspend' ? 'suspended' : 'running';
          return resolved();
        }
        if (item.op === 'event-add' || item.op === 'event-remove') {
          const owner = context(self)[0];
          const type = String(args[0]);
          const callback = args[1];
          if (typeof callback !== 'function') return undefined;
          let byType = listeners.get(owner);
          if (!byType) { byType = new Map(); listeners.set(owner, byType); }
          let values = byType.get(type);
          if (!values) { values = new Set(); byType.set(type, values); }
          if (item.op === 'event-add') values.add(callback); else values.delete(callback);
          return undefined;
        }
        if (item.op === 'event-dispatch') {
          const owner = context(self)[0];
          const event = object(port, args[0]);
          const type = String(Reflect.get(event, 'type'));
          fire(owner, type, event);
          return true;
        }
        if (item.op === 'get') return get(item, self);
        if (item.op === 'set') {
          const field = String(item.field);
          if (item.scope === 'handler') { handlers.set(context(self)[0], args[0] ?? null); return undefined; }
          if (item.scope === 'node') {
            const state = node(self)[1];
            state.fields.set(field, args[0]);
            if (state.kind === 'analyser' && field === 'fftSize') {
              state.fields.set('frequencyBinCount', Math.trunc(number(args[0], 2048)) / 2);
            }
            return undefined;
          }
          if (item.scope === 'param') {
            const state = param(self)[1];
            if (field === 'automationRate') state.automationRate = String(args[0]);
            else if (field === 'value') state.value = number(args[0], state.value);
            return undefined;
          }
          throw new TypeError(`audio setter invalid:${String(item.scope)}.${field}`);
        }
        throw new TypeError(`audio Driver op invalid:${item.op}`);
      },
      construct: (raw, args) => {
        const item = config(raw);
        if (item.op === 'context-ctor') {
          const target = made(String(item.proto));
          const offline = item.kind === 'offline';
          let channels = 1;
          let length = 0;
          let sampleRate = 44100;
          const first = args[0];
          if (offline && first !== null && typeof first === 'object') {
            channels = number(Reflect.get(first, 'numberOfChannels'), 1);
            length = number(Reflect.get(first, 'length'), 0);
            sampleRate = number(Reflect.get(first, 'sampleRate'), 44100);
          } else if (offline) {
            channels = number(args[0], 1);
            length = number(args[1], 0);
            sampleRate = number(args[2], 44100);
          } else if (first !== null && typeof first === 'object') {
            sampleRate = number(Reflect.get(first, 'sampleRate'), 44100);
          }
          contexts.set(target, {
            kind: offline ? 'offline' : 'context',
            channels: Math.max(1, Math.trunc(channels)),
            length: Math.max(0, Math.trunc(length)),
            sampleRate,
            state: offline ? 'suspended' : 'running',
          });
          return target;
        }
        if (item.op === 'buffer-ctor') {
          const options = args[0];
          if (options === null || typeof options !== 'object') return makeBuffer(1, 0, 44100);
          return makeBuffer(
            Reflect.get(options, 'numberOfChannels'),
            Reflect.get(options, 'length'),
            Reflect.get(options, 'sampleRate'),
          );
        }
        if (item.op === 'illegal') {
          throw port.error('TypeError', `Failed to construct '${String(item.name)}': Illegal constructor`);
        }
        throw new TypeError(`audio Driver construct invalid:${item.op}`);
      },
    };
  },
};
