import type { Feature, FnPart } from '../shape/types.js';

export interface SurfaceMember {
  readonly path: string;
  readonly key: string;
  readonly part: FnPart;
}

export interface BuiltinFeature extends Feature {
  /** Members provided by this Feature instead of generic DOM wrappers. */
  readonly reserves?: readonly SurfaceMember[];
}
