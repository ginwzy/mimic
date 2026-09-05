import { MimicError } from '../core/error.js';
import { parseShape } from '../core/parse.js';
import { digest, seal } from '../core/seal.js';
import type { Hash, Shape, Source, Target } from '../core/types.js';

const BASELINES: Record<string, { hash: Hash; file: string }> = {
  'chromium/chrome/linux/desktop/143': {
    hash: '8bb471bc084776b3988ef08d73d10ba0eeea6d19d3af061133b3a91c1f6e6d1d' as Hash,
    file: 'resources/baselines/linux-chrome-v143.json',
  },
  'chromium/chrome/macos/desktop/148': {
    hash: '1f747c9d2d4c0964f78e59014e7acef9c4b6fa506d5809857f741a624248f105' as Hash,
    file: 'resources/baselines/macos-chrome-v148.json',
  },
  'chromium/chrome/macos/desktop/149': {
    hash: '7d1c22a4af2c78df674f8268eead5fad0ee4c19855a486a45fb08aada415800d' as Hash,
    file: 'resources/baselines/macos-chrome-v149.json',
  },
  'chromium/webview/android/mobile/138': {
    hash: 'bcd3ffb7b184eb61ab23827c1a6de256def5b3f4eb33b4bbbb9b01b7cc01bea5' as Hash,
    file: 'resources/baselines/android-webview-v138.json',
  },
};
const SHAPES = new Map<string, Shape>();

export async function shapeForTarget(target: Target): Promise<Shape> {
  const id = `chromium/${target.host}/${target.platform}/${target.form}/${target.version}`;
  const cached = SHAPES.get(id);
  if (cached) return cached;
  const baseline = BASELINES[id];
  const source: Source = baseline
    ? { kind: 'capture', hash: baseline.hash, file: baseline.file }
    : { kind: 'derived', hash: digest({ rule: 'legacy-shape-v1', target }), rule: 'legacy-shape-v1' };
  // Derived targets compile from feature tables. Dynamic so worker init stays on baked JSON.
  const { shape: builtShape } = await import('../features/shape.js');
  const shape = builtShape(parseShape(seal({
    schema: 2 as const,
    id,
    target,
    level: baseline ? 'captured' as const : 'derived' as const,
    source,
    features: [],
    ops: [],
    support: { structure: baseline ? 'captured' : 'derived' },
  })));
  SHAPES.set(id, shape);
  return shape;
}

export function compatibleShape(shape: Shape, target: Target): Shape {
  const parsed = parseShape(shape);
  const id = `chromium/${target.host}/${target.platform}/${target.form}/${target.version}`;
  const fields = ['engine', 'host', 'platform', 'form', 'version'] as const;
  if (parsed.id !== id || fields.some((field) => parsed.target[field] !== target[field])) {
    throw new MimicError({
      phase: 'parse',
      code: 'BAD_SHAPE',
      message: `Shape 与旧 Profile target 不一致:${parsed.id}`,
    });
  }
  return parsed;
}

