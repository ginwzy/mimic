import { createRequire } from 'node:module';
import { createTouchList } from './touch.js';

const { implSymbol } = createRequire(import.meta.url)('jsdom/lib/generated/idl/utils.js') as { implSymbol: symbol };

type TouchEventInitModule = {
  convert(globalObject: object, value: unknown, options: unknown): Record<string, unknown>;
};

const HOOKED_TOUCH_EVENT_INIT = new WeakSet<object>();
const TOUCH_LIST_FIELDS = ['touches', 'targetTouches', 'changedTouches'] as const;
const FRAME_OWNERS = new WeakMap<object, (child: unknown) => void>();
const FRAME_ATTACH_HOOKS = new WeakSet<object>();
const FRAME_ATTRIBUTE_HOOKS = new WeakSet<object>();

/** Keep host observers out of page-overridable addEventListener methods. */
export function observeJsdomEvent(target: object, type: string, callback: () => void, once = false): () => void {
  const require = createRequire(import.meta.url);
  const eventTargetIDL = require('jsdom/lib/generated/idl/EventTarget.js') as { is(value: unknown): boolean };
  if (!eventTargetIDL.is(target)) throw new TypeError('Expected a jsdom EventTarget');
  const targetImpl = jsdomImplementation(target, 'EventTarget');
  const listener = Object.assign(() => callback(), { objectReference: callback });
  Reflect.apply(targetImpl.addEventListener as Function, targetImpl, [type, listener, { capture: false, once }]);
  return () => {
    Reflect.apply(targetImpl.removeEventListener as Function, targetImpl, [type, listener, false]);
  };
}

/** resources.interceptors enables subresources in jsdom; keep offline loading behavior. */
export function disableJsdomSubresources(window: object): void {
  Reflect.set(window, '_loadSubresources', false);
  const document = jsdomImplementation(Reflect.get(window, 'document'), 'Document');
  Reflect.set(document._resourceLoader as object, '_loadSubresources', false);
}

/** Process-wide hooks retain only weak references to individual Realm trees. */
export function installJsdomHooks(): void {
  const require = createRequire(import.meta.url);
  const touchEventInit = require('jsdom/lib/generated/idl/TouchEventInit.js') as TouchEventInitModule;
  if (HOOKED_TOUCH_EVENT_INIT.has(touchEventInit)) return;
  const originalConvert = touchEventInit.convert;
  touchEventInit.convert = (globalObject, value, options) => {
    const output = Reflect.apply(originalConvert, touchEventInit, [globalObject, value, options]) as Record<string, unknown>;
    const touchListConstructor = Reflect.get(globalObject, 'TouchList');
    if (typeof touchListConstructor !== 'function') return output;
    for (const field of TOUCH_LIST_FIELDS) {
      const items = output[field];
      if (Array.isArray(items)) output[field] = createTouchList(touchListConstructor, items);
    }
    return output;
  };
  HOOKED_TOUCH_EVENT_INIT.add(touchEventInit);
}

export function watchFrameOwner(owner: object, install: (child: unknown) => void): void {
  FRAME_OWNERS.set(owner, install);
}

function ownerOf(value: unknown, method: string): object | undefined {
  let prototype = value !== null && typeof value === 'object' ? Object.getPrototypeOf(value) as object | null : null;
  while (prototype && !Object.hasOwn(prototype, method)) prototype = Object.getPrototypeOf(prototype) as object | null;
  return prototype ?? undefined;
}

function dispatchFrame(frame: unknown): void {
  if (frame === null || typeof frame !== 'object') return;
  const item = frame as {
    _ownerDocument?: { _defaultView?: object };
    contentWindow?: { _globalProxy?: unknown };
  };
  const owner = item._ownerDocument?._defaultView;
  const install = owner && (FRAME_OWNERS.get(owner)
    ?? FRAME_OWNERS.get((owner as { _globalProxy?: object })._globalProxy ?? owner));
  const child = item.contentWindow;
  if (install && child) install(child._globalProxy ?? child);
}

export function hookFrameLifecycle(frame: unknown): void {
  const attachOwner = ownerOf(frame, '_attach');
  if (attachOwner && !FRAME_ATTACH_HOOKS.has(attachOwner)) {
    const desc = Object.getOwnPropertyDescriptor(attachOwner, '_attach');
    if (desc && typeof desc.value === 'function') {
      const original = desc.value as (...args: unknown[]) => unknown;
      Object.defineProperty(attachOwner, '_attach', {
        ...desc,
        value: function frameAttach(this: unknown, ...args: unknown[]) {
          const result = Reflect.apply(original, this, args);
          dispatchFrame(this);
          return result;
        },
      });
      FRAME_ATTACH_HOOKS.add(attachOwner);
    }
  }
  const attributeOwner = ownerOf(frame, '_attrModified');
  if (attributeOwner && !FRAME_ATTRIBUTE_HOOKS.has(attributeOwner)) {
    const desc = Object.getOwnPropertyDescriptor(attributeOwner, '_attrModified');
    if (desc && typeof desc.value === 'function') {
      const original = desc.value as (...args: unknown[]) => unknown;
      Object.defineProperty(attributeOwner, '_attrModified', {
        ...desc,
        value: function frameAttribute(this: unknown, ...args: unknown[]) {
          const result = Reflect.apply(original, this, args);
          dispatchFrame(this);
          return result;
        },
      });
      FRAME_ATTRIBUTE_HOOKS.add(attributeOwner);
    }
  }
}

export function jsdomImplementation(wrapper: unknown, name: string): Record<PropertyKey, unknown> {
  if ((typeof wrapper !== 'object' && typeof wrapper !== 'function') || wrapper === null) {
    throw new TypeError(`${name} is not a jsdom wrapper`);
  }
  const implementation = Reflect.get(wrapper, implSymbol);
  if ((typeof implementation !== 'object' && typeof implementation !== 'function') || implementation === null) {
    throw new TypeError(`${name} has no jsdom implementation`);
  }
  return implementation as Record<PropertyKey, unknown>;
}
