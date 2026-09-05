import { createRequire } from 'node:module';
import { createTouchList } from './touch.js';

type TouchEventInitModule = {
  convert(globalObject: object, value: unknown, options: unknown): Record<string, unknown>;
};

const HOOKED_TOUCH_EVENT_INIT = new WeakSet<object>();
const TOUCH_LIST_FIELDS = ['touches', 'targetTouches', 'changedTouches'] as const;
const FRAME_OWNERS = new WeakMap<object, (child: unknown) => void>();
const FRAME_ATTACH_HOOKS = new WeakSet<object>();
const FRAME_ATTRIBUTE_HOOKS = new WeakSet<object>();

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
  const key = Object.getOwnPropertySymbols(wrapper).find((symbol) => symbol.description === 'impl');
  const implementation = key === undefined ? undefined : Reflect.get(wrapper, key);
  if ((typeof implementation !== 'object' && typeof implementation !== 'function') || implementation === null) {
    throw new TypeError(`${name} has no jsdom implementation`);
  }
  return implementation as Record<PropertyKey, unknown>;
}
