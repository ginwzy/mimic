import type { PageLayout, LayoutRect, LayoutScroll } from '../core/layout.js';

export interface LayoutReplay {
  check(): void;
  close(): void;
  project(x: number, y: number): { pageX: number; pageY: number; screenX: number; screenY: number };
  begin(target: Element): { target: number; x: boolean; y: boolean };
  pan(contact: { target: number; x: boolean; y: boolean }, dx: number, dy: number): boolean;
}

/** Serialized into the root Realm. All getters, errors and returned objects stay in that Realm. */
export function installLayout(data: PageLayout, dispatch: (target: EventTarget, event: Event) => unknown): LayoutReplay {
  'use strict';
  const { viewport, nodes, root } = data;
  const elements = nodes.map(node => {
    const matches = document.querySelectorAll(node.selector);
    if (matches.length !== 1) throw new Error(`LAYOUT_INVALID: selector is not unique: ${node.selector}`);
    return matches[0]!;
  });
  const indices = new Map(elements.map((element, index) => [element, index]));
  let invalid: string | undefined;
  const fail = (reason: string): never => {
    invalid ??= reason;
    throw new Error(`LAYOUT_INVALID: ${invalid}`);
  };
  if (indices.size !== nodes.length || elements[0] !== document.documentElement || !indices.has(document.body)) {
    fail('nodes must uniquely cover documentElement and body');
  }
  nodes.forEach((node, index) => {
    const element = elements[index]!;
    if (index && element.parentElement !== elements[node.parent!]) fail(`DOM parent mismatch: ${node.selector}`);
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') fail('only HTML boxes are supported');
    const style = getComputedStyle(element);
    if (['fixed', 'sticky'].includes(style.position) || [style.overflowX, style.overflowY].includes('clip')
      || (style.transform && style.transform !== 'none')
      || (style.clipPath && style.clipPath !== 'none') || (style.clip && style.clip !== 'auto') || style.direction === 'rtl'
      || (style.writingMode && style.writingMode !== 'horizontal-tb')
      || (style.scrollSnapType && style.scrollSnapType !== 'none') || style.scrollBehavior === 'smooth'
      || (style.animationName && style.animationName !== 'none')
      || [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].some(value => parseFloat(value) > 0)
      || [style.borderTopWidth, style.borderLeftWidth, style.borderRightWidth, style.borderBottomWidth].some(value => parseFloat(value) > 0)
      || (style.zoom && !['1', 'normal'].includes(style.zoom))) {
      fail(`unsupported CSS geometry or scrolling behavior: ${node.selector}`);
    }
  });
  for (const element of document.body.querySelectorAll('*')) {
    if (!['SCRIPT', 'STYLE'].includes(element.tagName) && !indices.has(element)) fail('unmapped body element');
  }
  const styles = () => JSON.stringify(Array.from(document.styleSheets, sheet => ({
    disabled: !!sheet.disabled, media: sheet.media?.mediaText ?? '',
    rules: Array.from(sheet.cssRules, rule => rule.cssText),
  })));
  const originalStyles = styles();
  const dynamicRules = (rules: CSSRuleList): boolean => Array.from(rules).some(rule => {
    if (rule.type === CSSRule.KEYFRAMES_RULE) return true;
    if ('selectorText' in rule && /:(?:hover|active|focus|checked|disabled|enabled|valid|invalid|indeterminate|placeholder-shown|target|visited|open)\b/.test(String(rule.selectorText))) return true;
    const children = Reflect.get(rule, 'cssRules') as CSSRuleList | undefined;
    return children ? dynamicRules(children) : false;
  });
  if (Array.from(document.styleSheets).some(sheet => dynamicRules(sheet.cssRules))) {
    fail('dynamic CSS states require new layout evidence');
  }
  // Keep records until check(), including mutations swallowed by page exception handlers.
  const records: MutationRecord[] = [];
  const changes = new MutationObserver(batch => { records.push(...batch); });
  changes.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const takeRecords = changes.takeRecords.bind(changes);
  const disconnect = changes.disconnect.bind(changes);
  const check = () => {
    if (invalid) fail(invalid);
    const mutations = records.splice(0).concat(takeRecords());
    for (const mutation of mutations) {
      // Runtime's currentScript wrapper inserts a non-executing head script temporarily.
      const headScript = mutation.type === 'childList' && mutation.target === document.head
        && [...mutation.addedNodes, ...mutation.removedNodes].every(node => node.nodeName === 'SCRIPT');
      if (!headScript) fail('DOM changed; a new layout snapshot is required');
    }
    if (innerWidth !== viewport.width || innerHeight !== viewport.height) fail('viewport does not match layout evidence');
    if (styles() !== originalStyles) fail('CSSOM changed; a new layout snapshot is required');
    if (elements.some(element => element.shadowRoot !== null || element.tagName === 'IFRAME')) fail('shadow trees and frames are not supported');
  };
  check();
  const indexOf = (self: unknown): number => {
    check();
    const index = indices.get(self as Element);
    if (index === undefined) return fail('geometry requested for an unmapped element');
    return index;
  };
  const scrollOf = (index: number): LayoutScroll | undefined => index === 0 ? root : nodes[index]!.scroll;
  const sizeOf = (index: number) => index === 0 ? viewport : nodes[index]!.rect;
  const rectangle = (index: number): LayoutRect => {
    const node = nodes[index]!;
    let x = node.rect.x - root.left;
    let y = node.rect.y - root.top;
    for (let parent = node.parent; parent !== null; parent = nodes[parent]!.parent) {
      const ancestor = nodes[parent]!;
      x += ancestor.rect.x;
      y += ancestor.rect.y;
      if (parent !== 0) {
        x -= ancestor.scroll?.left ?? 0;
        y -= ancestor.scroll?.top ?? 0;
      }
    }
    return { x, y, width: node.rect.width, height: node.rect.height };
  };
  const contains = (rect: LayoutRect, x: number, y: number) => x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
  const hit = (x: number, y: number): Element[] => {
    check();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !contains({ x: 0, y: 0, ...viewport }, x, y)) return [];
    return data.paintOrder.filter(index => {
      if (!nodes[index]!.hit || (index !== 0 && !contains(rectangle(index), x, y))) return false;
      for (let parent = nodes[index]!.parent; parent !== null; parent = nodes[parent]!.parent) {
        if (parent !== 0 && nodes[parent]!.clip && !contains(rectangle(parent), x, y)) return false;
      }
      return true;
    }).map(index => elements[index]!);
  };
  const dirtyScroll = new Set<number>();
  let timer: number | undefined;
  const queueScroll = (index: number) => {
    dirtyScroll.add(index);
    timer ??= window.setTimeout(() => {
      timer = undefined;
      check();
      const changed = [...dirtyScroll];
      dirtyScroll.clear();
      for (const item of changed) {
        if (item === 0) {
          dispatch(document, new Event('scroll', { bubbles: true }));
          if (visualViewport) dispatch(visualViewport, new Event('scroll'));
        } else dispatch(elements[item]!, new Event('scroll'));
      }
    }, 0);
  };
  const setScroll = (index: number, left: number, top: number) => {
    check();
    const scroll = scrollOf(index);
    if (!scroll) return;
    const size = sizeOf(index);
    const x = Math.max(0, Math.min(scroll.width - Math.round(size.width), Number.isFinite(left) ? left : 0));
    const y = Math.max(0, Math.min(scroll.height - Math.round(size.height), Number.isFinite(top) ? top : 0));
    if (x === scroll.left && y === scroll.top) return;
    scroll.left = x;
    scroll.top = y;
    queueScroll(index);
  };
  const scroll = (index: number, relative: boolean, x?: number | ScrollToOptions, y?: number) => {
    check();
    const current = scrollOf(index);
    if (!current) return;
    const options: { left?: number | undefined; top?: number | undefined; behavior?: ScrollBehavior } =
      typeof x === 'object' && x !== null ? x : { left: x, top: y };
    if (options.behavior && options.behavior !== 'instant') fail('only explicit instant scrolling is supported');
    setScroll(index,
      options.left === undefined ? current.left : Number(options.left) + (relative ? current.left : 0),
      options.top === undefined ? current.top : Number(options.top) + (relative ? current.top : 0));
  };
  const getter = (target: object, name: string, get: (this: unknown) => unknown, set?: (this: unknown, value: number) => void) => {
    Object.defineProperty(target, name, { configurable: true, enumerable: true, get, ...(set ? { set } : {}) });
  };
  const method = (target: object, name: string, value: Function) => {
    Object.defineProperty(target, name, { configurable: true, enumerable: true, writable: true, value });
  };
  let visualScrollHandler: ((this: VisualViewport, event: Event) => unknown) | null = null;
  const visualScrollListener = (event: Event) => visualScrollHandler?.call(visualViewport!, event);
  Object.defineProperty(Object.getPrototypeOf(visualViewport), 'onscroll', {
    configurable: true, enumerable: true,
    get: () => visualScrollHandler,
    set: (value: unknown) => {
      const next = typeof value === 'function' ? value as typeof visualScrollHandler : null;
      if (!visualScrollHandler && next) visualViewport!.addEventListener('scroll', visualScrollListener);
      if (visualScrollHandler && !next) visualViewport!.removeEventListener('scroll', visualScrollListener);
      visualScrollHandler = next;
    },
  });
  for (const name of ['scrollX', 'pageXOffset']) getter(window, name, () => { check(); return root.left; });
  for (const name of ['scrollY', 'pageYOffset']) getter(window, name, () => { check(); return root.top; });
  for (const [name, value] of [['pageLeft', () => root.left], ['pageTop', () => root.top]] as const) {
    getter(Object.getPrototypeOf(visualViewport), name, function () {
      check();
      if (this !== visualViewport) throw new TypeError('Illegal invocation');
      return value();
    });
  }
  getter(Document.prototype, 'scrollingElement', function () {
    check();
    if (this !== document) throw new TypeError('Illegal invocation');
    return document.documentElement;
  });
  for (const [name, field] of [['scrollLeft', 'left'], ['scrollTop', 'top']] as const) {
    getter(Element.prototype, name,
      function () { return scrollOf(indexOf(this))?.[field] ?? 0; },
      function (value) {
        const index = indexOf(this);
        const current = scrollOf(index);
        if (current) setScroll(index, field === 'left' ? Number(value) : current.left, field === 'top' ? Number(value) : current.top);
      });
  }
  for (const [name, axis] of [['clientWidth', 'width'], ['clientHeight', 'height'], ['scrollWidth', 'width'], ['scrollHeight', 'height']] as const) {
    getter(Element.prototype, name, function () {
      const index = indexOf(this);
      return Math.round((name.startsWith('scroll') ? scrollOf(index)?.[axis] : undefined) ?? sizeOf(index)[axis]);
    });
  }
  for (const name of ['clientTop', 'clientLeft']) getter(Element.prototype, name, function () { indexOf(this); return 0; });
  method(Element.prototype, 'getBoundingClientRect', function getBoundingClientRect(this: Element) {
    const r = rectangle(indexOf(this));
    return new DOMRect(r.x, r.y, r.width, r.height);
  });
  method(Element.prototype, 'getClientRects', function getClientRects(this: Element) {
    indexOf(this);
    return fail('fragment geometry is not part of layout-v1');
  });
  method(Document.prototype, 'elementsFromPoint', function elementsFromPoint(this: Document, x: number, y: number) {
    if (this !== document) throw new TypeError('Illegal invocation');
    return hit(Number(x), Number(y));
  });
  method(Document.prototype, 'elementFromPoint', function elementFromPoint(this: Document, x: number, y: number) {
    if (this !== document) throw new TypeError('Illegal invocation');
    return hit(Number(x), Number(y))[0] ?? null;
  });
  for (const name of ['scroll', 'scrollTo', 'scrollBy']) {
    method(window, name, function (x?: number | ScrollToOptions, y?: number) { scroll(0, name === 'scrollBy', x, y); });
    method(Element.prototype, name, function (this: Element, x?: number | ScrollToOptions, y?: number) { scroll(indexOf(this), name === 'scrollBy', x, y); });
  }
  for (const name of ['offsetTop', 'offsetLeft', 'offsetParent']) {
    getter(HTMLElement.prototype, name, function () { indexOf(this); return fail('offset-parent geometry is not part of layout-v1'); });
  }
  for (const [name, axis] of [['offsetWidth', 'width'], ['offsetHeight', 'height']] as const) {
    getter(HTMLElement.prototype, name, function () { return Math.round(nodes[indexOf(this)]!.rect[axis]); });
  }
  for (const name of ['scrollIntoView', 'scrollIntoViewIfNeeded', 'attachShadow']) {
    method(Element.prototype, name, () => fail(`${name} is not part of layout-v1`));
  }
  return {
    check,
    close: () => { disconnect(); records.length = 0; if (timer !== undefined) clearTimeout(timer); dirtyScroll.clear(); },
    project: (x, y) => {
      check();
      return { pageX: x + root.left, pageY: y + root.top, screenX: x + viewport.screenOffsetX, screenY: y + viewport.screenOffsetY };
    },
    begin: target => {
      const index = indexOf(target);
      let x = true;
      let y = true;
      for (let at: number | null = index; at !== null; at = nodes[at]!.parent) {
        const action = nodes[at]!.touchAction;
        x &&= action === 'auto' || action === 'pan-x';
        y &&= action === 'auto' || action === 'pan-y';
        if (scrollOf(at)) break;
      }
      return { target: index, x, y };
    },
    pan: (contact, dx, dy) => {
      check();
      let remainingX = contact.x ? dx : 0;
      let remainingY = contact.y ? dy : 0;
      let handled = false;
      for (let at: number | null = contact.target; at !== null; at = nodes[at]!.parent) {
        const state = scrollOf(at);
        if (!state) continue;
        const size = sizeOf(at);
        const x = ['x', 'both'].includes(state.pan) && state.width > Math.round(size.width) ? remainingX : 0;
        const y = ['y', 'both'].includes(state.pan) && state.height > Math.round(size.height) ? remainingY : 0;
        if (x === 0 && y === 0) continue;
        handled = true;
        const beforeX = state.left;
        const beforeY = state.top;
        setScroll(at, state.left + x, state.top + y);
        remainingX -= state.left - beforeX;
        remainingY -= state.top - beforeY;
        if (state.overscroll === 'contain') break;
      }
      return handled;
    },
  };
}
