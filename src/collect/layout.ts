import type { PageLayout } from '../core/layout.js';

export interface LayoutCaptureOptions {
  /** DOM-parent order, beginning with documentElement. Include every body box. */
  selectors: string[];
  /** Explicit front-to-back stacking order; selectors must match the same set. */
  paintOrder: string[];
  screenOffsetX: number;
  screenOffsetY: number;
  rootPan: 'none' | 'x' | 'y' | 'both';
  rootOverscroll: 'auto' | 'contain';
}

/** Self-contained browser probe; serialize this function for browser-side evaluation. */
export function captureLayout(options: LayoutCaptureOptions): PageLayout {
  if (document.compatMode !== 'CSS1Compat') throw new Error('Layout capture requires standards mode');
  const elements = options.selectors.map(selector => {
    const matches = document.querySelectorAll(selector);
    if (matches.length !== 1) throw new Error(`Layout selector must match exactly once: ${selector}`);
    return matches[0]!;
  });
  if (elements[0] !== document.documentElement) throw new Error('First layout selector must be documentElement');
  if (new Set(elements).size !== elements.length) throw new Error('Duplicate layout element');
  if (!Number.isFinite(options.screenOffsetX) || !Number.isFinite(options.screenOffsetY)) throw new Error('Measured screen offsets are required');
  if (visualViewport && (visualViewport.scale !== 1 || visualViewport.offsetLeft !== 0 || visualViewport.offsetTop !== 0)) {
    throw new Error('Layout capture requires scale=1 and no visual viewport offset');
  }
  const dynamicRules = (rules: CSSRuleList): boolean => Array.from(rules).some(rule => {
    if (rule.type === CSSRule.KEYFRAMES_RULE) return true;
    if ('selectorText' in rule && /:(?:hover|active|focus|checked|disabled|enabled|valid|invalid|indeterminate|placeholder-shown|target|visited|open)\b/.test(String(rule.selectorText))) return true;
    const children = Reflect.get(rule, 'cssRules') as CSSRuleList | undefined;
    return children ? dynamicRules(children) : false;
  });
  if (Array.from(document.styleSheets).some(sheet => dynamicRules(sheet.cssRules))) throw new Error('Dynamic CSS states are not part of layout-v1');
  const rects = elements.map(element => element.getBoundingClientRect());
  if (Math.abs(rects[0]!.left + scrollX) > 1 / 64 || Math.abs(rects[0]!.top + scrollY) > 1 / 64) {
    throw new Error('Layout-v1 requires the root rectangle to start at the document origin');
  }
  if (elements.some(element => element.getClientRects().length > 1)) throw new Error('Fragmented boxes are not part of layout-v1');
  const nodes: PageLayout['nodes'] = elements.map((element, index) => {
    const parent = index === 0 ? null : elements.indexOf(element.parentElement!);
    if (parent !== null && (parent < 0 || parent >= index)) throw new Error('Selectors must follow DOM-parent order');
    const style = getComputedStyle(element);
    if (['fixed', 'sticky'].includes(style.position) || (style.transform && style.transform !== 'none')
      || (style.clipPath && style.clipPath !== 'none') || (style.clip && style.clip !== 'auto') || style.direction === 'rtl'
      || (style.writingMode && style.writingMode !== 'horizontal-tb')
      || (style.scrollSnapType && style.scrollSnapType !== 'none') || style.scrollBehavior === 'smooth'
      || (style.animationName && style.animationName !== 'none')
      || [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].some(value => parseFloat(value) > 0)
      || [style.borderTopWidth, style.borderLeftWidth, style.borderRightWidth, style.borderBottomWidth].some(value => parseFloat(value) > 0)
      || (style.zoom && !['1', 'normal'].includes(style.zoom))) throw new Error('Unsupported CSS geometry or scrolling behavior');
    if ([style.overflowX, style.overflowY].includes('clip')) throw new Error('overflow:clip is not part of layout-v1');
    if (!['auto', 'none', 'pan-x', 'pan-y'].includes(style.touchAction)) throw new Error(`Unsupported touch-action: ${style.touchAction}`);
    const rect = rects[index]!;
    const parentRect = parent === null ? rect : rects[parent]!;
    const scrollX = parent === null || parent === 0 ? 0 : elements[parent]!.scrollLeft;
    const scrollY = parent === null || parent === 0 ? 0 : elements[parent]!.scrollTop;
    const clips = (overflow: string) => ['auto', 'scroll', 'hidden', 'clip'].includes(overflow);
    const clip = clips(style.overflowX) || clips(style.overflowY);
    if (clip && clips(style.overflowX) !== clips(style.overflowY)) throw new Error('Layout-v1 requires rectangular two-axis clipping');
    const panX = ['auto', 'scroll'].includes(style.overflowX);
    const panY = ['auto', 'scroll'].includes(style.overflowY);
    let pan: 'none' | 'x' | 'y' | 'both' = 'none';
    if (panX && panY) pan = 'both';
    else if (panX) pan = 'x';
    else if (panY) pan = 'y';
    if (style.overscrollBehaviorX !== style.overscrollBehaviorY) throw new Error('Layout-v1 requires matching overscroll behavior on both axes');
    return {
      selector: options.selectors[index]!, parent,
      rect: { x: rect.x - parentRect.x + scrollX, y: rect.y - parentRect.y + scrollY, width: rect.width, height: rect.height },
      hit: style.pointerEvents !== 'none' && style.visibility === 'visible' && style.display !== 'none',
      clip,
      touchAction: style.touchAction as PageLayout['nodes'][number]['touchAction'],
      ...(index !== 0 && clip ? { scroll: {
        width: element.scrollWidth, height: element.scrollHeight, left: element.scrollLeft, top: element.scrollTop,
        pan, overscroll: style.overscrollBehaviorY === 'auto' ? 'auto' as const : 'contain' as const,
      } } : {}),
    };
  });
  const paintOrder = options.paintOrder.map(selector => options.selectors.indexOf(selector));
  if (paintOrder.length !== nodes.length || new Set(paintOrder).size !== nodes.length || paintOrder.includes(-1)) {
    throw new Error('Paint order must contain every layout selector exactly once');
  }
  return {
    version: 1,
    viewport: { width: innerWidth, height: innerHeight, screenOffsetX: options.screenOffsetX, screenOffsetY: options.screenOffsetY },
    root: {
      width: document.scrollingElement!.scrollWidth, height: document.scrollingElement!.scrollHeight,
      left: window.scrollX, top: window.scrollY, pan: options.rootPan, overscroll: options.rootOverscroll,
    },
    nodes, paintOrder,
  };
}
