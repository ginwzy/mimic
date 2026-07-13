import { createHash } from 'node:crypto';
import { MimicError } from '../core/error.js';
import { parseCatalog } from '../core/parse.js';
import { digest, seal } from '../core/seal.js';
import { canonical } from '../core/canonical.js';
import { isTrustedShape } from '../core/trusted.js';
import type { CatalogDoc, Hash, JsonValue, Shape, ShapeRef } from '../core/types.js';
import type { CatalogPort, Feature } from '../shape/types.js';

export class Catalog implements CatalogPort {
  readonly id: string;
  readonly hash: Hash;
  readonly data: CatalogDoc;
  private readonly shapes: ReadonlyMap<string, Shape>;
  private readonly features: ReadonlyMap<string, Feature>;

  constructor(input: unknown, features: readonly Feature[] = [], trusted = false) {
    this.data = trusted ? input as CatalogDoc : parseCatalog(input);
    this.id = this.data.id;
    const featureMap = new Map<string, Feature>();
    for (const feature of features) {
      const rev = feature.rev ?? '1';
      if (!/^[a-z][a-z0-9.-]*$/.test(feature.id) || typeof rev !== 'string' || !rev || typeof feature.build !== 'function') {
        throw new MimicError({ phase: 'compile', code: 'BAD_PLAN', message: 'Catalog Feature 定义非法' });
      }
      if (featureMap.has(feature.id)) throw new MimicError({ phase: 'compile', code: 'DUPLICATE_FEATURE', message: `Catalog Feature 重复:${feature.id}` });
      featureMap.set(feature.id, Object.freeze({
        id: feature.id,
        rev,
        ...(feature.requires === undefined ? {} : { requires: Object.freeze([...feature.requires]) }),
        build: feature.build,
      }));
    }
    this.features = featureMap;
    this.shapes = new Map(this.data.shapes.map((shape) => [shape.id, shape]));
    this.hash = digest({
      data: this.data.hash,
      features: [...featureMap.values()].map(({ id, rev = '1' }) => ({ id, rev })).sort((left, right) => left.id < right.id ? -1 : 1),
    });
  }

  resolve(ref: ShapeRef): { shape: Shape; features: readonly Feature[] } {
    const shape = this.shapes.get(ref.id);
    if (!shape || shape.hash !== ref.hash) {
      throw new MimicError({ phase: 'compile', code: 'BAD_SHAPE', message: `Catalog 无法解析 Shape:${ref.id}` });
    }
    const features = shape.features.map((id) => {
      const feature = this.features.get(id);
      if (!feature) throw new MimicError({ phase: 'compile', code: 'NO_FEATURE', message: `Catalog 缺少 Feature:${id}` });
      return feature;
    });
    return { shape, features };
  }

  list(): readonly Shape[] {
    return this.data.shapes;
  }

  static create(id: string, shapes: readonly Shape[], features: readonly Feature[] = []): Catalog {
    const sorted = [...shapes].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    if (/^[a-z][a-z0-9.-]*$/.test(id) && sorted.every(isTrustedShape)
      && new Set(sorted.map((shape) => shape.id)).size === sorted.length) {
      const body = Object.freeze({ schema: 2 as const, id, shapes: Object.freeze(sorted) });
      const hash = createHash('sha256').update(canonical(body as unknown as JsonValue)).digest('hex') as Hash;
      return new Catalog(Object.freeze({ ...body, hash }), features, true);
    }
    return new Catalog(seal({ schema: 2 as const, id, shapes: sorted }), features);
  }
}
