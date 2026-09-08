import type { JsonValue } from '../core/types.js';
import type { Driver } from '../engine/types.js';

interface Config {
  type: string;
  member: string;
  action: string;
  length: number;
  quota: number;
}

const ACTIONS = new Set([
  'play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward',
  'skipad', 'stop', 'seekto', 'togglemicrophone', 'togglecamera', 'hangup',
  'previousslide', 'nextslide', 'enterpictureinpicture',
]);

export const capabilityDriver: Driver = {
  open: port => {
    const metadata = new WeakMap<object, Record<string, JsonValue>>();
    const session: { metadata: object | null; playbackState: string } = { metadata: null, playbackState: 'none' };
    const actions = new Map<string, Function>();
    const domString = port.evaluate('(value) => `${value}`') as (value: unknown) => string;
    const domNumber = port.evaluate('(value) => +value') as (value: unknown) => number;
    const schedule = port.evaluate('(callback) => setTimeout(callback, 0)') as (callback: () => void) => void;
    const fail = (message = 'Illegal invocation'): never => { throw port.error('TypeError', message); };
    const unsupported = (): never => {
      throw port.evaluate("new DOMException('This operation is not implemented in the offline Realm.', 'NotSupportedError')");
    };
    const isObject = (value: unknown): value is object => value !== null && (typeof value === 'object' || typeof value === 'function');
    const dictionary = (value: unknown): object => {
      if (value == null) return {};
      if (!isObject(value)) return fail("The provided value is not of type 'MediaMetadataInit'.");
      return value;
    };
    const images = (value: unknown): JsonValue[] => {
      if (!isObject(value) || typeof Reflect.get(value, Symbol.iterator) !== 'function') fail('Artwork must be a sequence.');
      return Array.from(value as Iterable<unknown>, item => {
        const image = dictionary(item);
        const sizes = Reflect.get(image, 'sizes');
        const src = Reflect.get(image, 'src');
        if (src === undefined) fail("Required member 'src' is undefined.");
        const source = domString(src);
        let url: URL;
        try { url = new URL(source, String(port.evaluate('document.baseURI'))); }
        catch { return fail(`Invalid artwork URL: ${source}`); }
        const type = Reflect.get(image, 'type');
        return { sizes: sizes === undefined ? '' : domString(sizes), src: url.href, type: type === undefined ? '' : domString(type) };
      });
    };
    const snapshot = (value: JsonValue[]): unknown => {
      const cloned = port.clone(value) as object[];
      for (const item of cloned) Object.freeze(item);
      return Object.freeze(cloned);
    };
    const checkReceiver = (item: Config, self: unknown): void => {
      if (item.action === 'static') return;
      let valid = false;
      switch (item.type) {
        case 'MediaMetadata': valid = isObject(self) && metadata.has(self); break;
        case 'MediaSession': valid = self === port.node('nav.cap.instance.mediaSession'); break;
        case 'Bluetooth': valid = self === port.node('nav.cap.instance.bluetooth'); break;
        case 'CredentialsContainer': valid = self === port.node('nav.cap.instance.credentials'); break;
        case 'DeprecatedStorageQuota':
          valid = self === port.node('nav.cap.instance.webkitTemporaryStorage') || self === port.node('nav.cap.instance.webkitPersistentStorage');
          break;
      }
      if (!valid) fail();
    };
    const invoke = (item: Config, self: unknown, args: readonly unknown[]): unknown => {
      checkReceiver(item, self);
      if (args.length < item.length) fail(`Failed to execute '${item.member}' on '${item.type}': ${item.length} argument required, but only ${args.length} present.`);
      if (item.type === 'DeprecatedStorageQuota') {
        const query = item.member === 'queryUsageAndQuota';
        const callbackIndex = query ? 0 : 1;
        let requested = 0;
        if (!query) {
          const n = domNumber(args[0]);
          requested = Number.isFinite(n) ? Math.trunc(n) % 2 ** 64 : 0;
          if (requested < 0) requested += 2 ** 64;
        }
        const callback = args[callbackIndex];
        if ((query || callback !== undefined) && typeof callback !== 'function') fail(`Failed to execute '${item.member}' on '${item.type}': parameter ${callbackIndex + 1} is not of type 'Function'.`);
        const errorCallback = args[callbackIndex + 1];
        if (errorCallback !== undefined && typeof errorCallback !== 'function') fail('Error callback is not of type Function.');
        if (typeof callback === 'function') schedule(() => Reflect.apply(callback, undefined, query ? [0, item.quota] : [Math.min(requested, item.quota)]));
        return undefined;
      }
      if (item.type === 'MediaMetadata') {
        const state = metadata.get(self as object)!;
        if (item.action === 'get') {
          const value = state[item.member]!;
          return Array.isArray(value) ? snapshot(value) : value;
        }
        if (item.action === 'set') {
          state[item.member] = item.member === 'artwork' ? images(args[0]) : domString(args[0]);
          return undefined;
        }
      }
      if (item.type === 'MediaSession') {
        if (item.action === 'get') return session[item.member as keyof typeof session];
        if (item.action === 'set') {
          if (item.member === 'metadata') {
            if (args[0] != null && (!isObject(args[0]) || !metadata.has(args[0]))) fail("Failed to set the 'metadata' property on 'MediaSession': Failed to convert value to 'MediaMetadata'.");
            session.metadata = args[0] == null ? null : args[0] as object;
          } else {
            const value = domString(args[0]);
            // Chrome ignores invalid playback-state enum assignments.
            if (['none', 'paused', 'playing'].includes(value)) session.playbackState = value;
          }
          return undefined;
        }
        if (item.member === 'setActionHandler') {
          const action = domString(args[0]);
          if (!ACTIONS.has(action)) fail(`Failed to execute 'setActionHandler' on 'MediaSession': The provided value '${action}' is not a valid enum value of type MediaSessionAction.`);
          const callback = args[1];
          if (callback != null && typeof callback !== 'function') fail('Action handler is not of type Function.');
          if (typeof callback === 'function') actions.set(action, callback);
          else actions.delete(action);
          return undefined;
        }
        if (item.member === 'setCameraActive' || item.member === 'setMicrophoneActive') return undefined;
        if (item.member === 'setPositionState' && args[0] == null) return undefined;
        return unsupported();
      }
      if (item.type === 'CredentialsContainer' && item.member === 'preventSilentAccess') return undefined;
      return unsupported();
    };
    return {
      call: (raw, self, args) => {
        const item = raw as unknown as Config;
        if (item.action === 'construct') fail(`Failed to construct '${item.type}': Please use the 'new' operator.`);
        if (item.action === 'navigator') {
          if (self !== port.node('nav.instance')) fail();
          return port.node(`nav.cap.instance.${item.member}`);
        }
        const returnsPromise = item.type === 'Bluetooth' || item.type === 'CredentialsContainer' || item.type === 'ContentIndex'
          || (item.action === 'static' && !item.member.startsWith('parse'));
        if (!returnsPromise) return invoke(item, self, args);
        try {
          return port.resolve(invoke(item, self, args) as JsonValue | undefined);
        } catch (error) {
          return port.resolve().then(() => { throw error; });
        }
      },
      construct: (raw, args, newTarget) => {
        const item = raw as unknown as Config;
        if (item.type !== 'MediaMetadata') fail(`Failed to construct '${item.type}': Illegal constructor`);
        const input = dictionary(args[0]);
        const state: Record<string, JsonValue> = {};
        // Dictionary members are read in WebIDL order, before exposing the instance.
        for (const key of ['album', 'artist', 'artwork', 'chapterInfo', 'title']) {
          const value = Reflect.get(input, key);
          if (key === 'artwork') state[key] = value === undefined ? [] : images(value);
          else if (key === 'chapterInfo') {
            if (value !== undefined && (!Array.isArray(value) || value.length !== 0)) unsupported();
            state[key] = [];
          } else state[key] = value === undefined ? '' : domString(value);
        }
        const instance = port.make('nav.cap.MediaMetadata.proto') as object;
        if (isObject(newTarget.prototype)) Object.setPrototypeOf(instance, newTarget.prototype);
        metadata.set(instance, state);
        return instance;
      },
    };
  },
};
