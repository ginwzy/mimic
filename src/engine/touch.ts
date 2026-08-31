const TOUCH_LIST_TOKEN = Object.freeze({});
const TOUCH_LIST_ITEMS = new WeakMap<object, readonly unknown[]>();

export function createTouchList(touchListConstructor: unknown, items: readonly unknown[]): object {
  if (typeof touchListConstructor !== 'function') throw new TypeError('TouchList constructor is unavailable');
  return Reflect.construct(touchListConstructor, [TOUCH_LIST_TOKEN, items]) as object;
}

export function touchListInitialization(args: readonly unknown[]): readonly unknown[] | undefined {
  return args[0] === TOUCH_LIST_TOKEN && Array.isArray(args[1]) ? args[1] : undefined;
}

export function registerTouchList(list: object, items: readonly unknown[]): readonly unknown[] {
  const snapshot = Object.freeze([...items]);
  TOUCH_LIST_ITEMS.set(list, snapshot);
  return snapshot;
}

export function touchListItems(list: object): readonly unknown[] | undefined {
  return TOUCH_LIST_ITEMS.get(list);
}
