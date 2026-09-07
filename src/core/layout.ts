import { Ajv } from 'ajv';
import schema from '../../schemas/v2/layout.schema.json' with { type: 'json' };

export interface LayoutRect { x: number; y: number; width: number; height: number }
export interface LayoutScroll {
  width: number;
  height: number;
  left: number;
  top: number;
  pan: 'none' | 'x' | 'y' | 'both';
  overscroll: 'auto' | 'contain';
}
export interface LayoutNode {
  selector: string;
  parent: number | null;
  rect: LayoutRect;
  hit: boolean;
  clip: boolean;
  touchAction: 'auto' | 'none' | 'pan-x' | 'pan-y';
  scroll?: LayoutScroll;
}
export interface PageLayout {
  version: 1;
  viewport: { width: number; height: number; screenOffsetX: number; screenOffsetY: number };
  root: LayoutScroll;
  /** DOM-parent order, starting with documentElement. Rectangles are parent-content relative. */
  nodes: LayoutNode[];
  /** Front-to-back paint order; must include every node exactly once. */
  paintOrder: number[];
}

const validate = new Ajv({ strict: true, allErrors: true }).compile<PageLayout>(schema);

export function checkLayout(value: unknown): asserts value is PageLayout {
  if (!validate(value)) throw new TypeError(`Invalid Page.layout: ${JSON.stringify(validate.errors)}`);
  const { nodes, paintOrder, root, viewport } = value;
  if (paintOrder.length !== nodes.length || paintOrder.some(index => index >= nodes.length)) {
    throw new TypeError('Page.layout.paintOrder must contain every node exactly once');
  }
  if (new Set(nodes.map(node => node.selector)).size !== nodes.length) throw new TypeError('Page.layout selectors must be unique');
  const checkScroll = (scroll: LayoutScroll, width: number, height: number) => {
    if (scroll.width < width || scroll.height < height || scroll.left > scroll.width - width || scroll.top > scroll.height - height) {
      throw new TypeError('Page.layout scroll dimensions or initial offset are out of bounds');
    }
  };
  checkScroll(root, viewport.width, viewport.height);
  nodes.forEach((node, index) => {
    if (index === 0) {
      if (node.parent !== null || node.scroll || node.rect.x !== 0 || node.rect.y !== 0) throw new TypeError('Page.layout root node must have zero origin, no parent and no local scrollport');
    } else if (node.parent === null || node.parent >= index) {
      throw new TypeError('Page.layout nodes must follow DOM-parent order');
    }
    if (node.scroll) {
      if (!node.clip) throw new TypeError('Page.layout scrollports must clip their descendants');
      checkScroll(node.scroll, Math.round(node.rect.width), Math.round(node.rect.height));
    }
  });
}
