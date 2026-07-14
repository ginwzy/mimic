import type { Bind, Data, Job, JsonValue, Page, Profile, ShapeRef, SupportMap } from '../core/types.js';

export type Ref = { path: string } | { node: string };
export type Key = string | { symbol: string };
export type StoredValue = { json: JsonValue } | { ref: Ref };

export type Desc =
  | {
    kind: 'data';
    value: StoredValue;
    writable: boolean;
    enumerable: boolean;
    configurable: boolean;
  }
  | {
    kind: 'accessor';
    get?: Ref;
    set?: Ref;
    enumerable: boolean;
    configurable: boolean;
  };

export interface FnShape {
  name: string;
  length: number;
  native: boolean;
  constructable: boolean;
  hasPrototype: boolean;
  keys: readonly string[];
}

export type FnPart = 'value' | 'get' | 'set';

export type AllocOp =
  | { op: 'alloc'; id: string; kind: 'object' }
  | { op: 'alloc'; id: string; kind: 'event' }
  | { op: 'alloc'; id: string; kind: 'proxy'; source: Ref; symbols: readonly string[] }
  | { op: 'alloc'; id: string; kind: 'function'; shape: FnShape; slot?: string; prototype?: Ref };

export type DraftOp =
  | AllocOp
  | { op: 'proto'; target: Ref; value: Ref | null }
  | { op: 'prop'; target: Ref; key: Key; desc: Desc }
  | { op: 'drop'; target: Ref; key: Key }
  | { op: 'fn'; target: Ref; key?: Key; part?: FnPart; shape: FnShape }
  | { op: 'order'; target: Ref; keys: readonly Key[] };

export type Op = DraftOp & { feature: string };
export type PlanBind = Bind & { feature: string };

export interface BuildContext {
  profile: Profile;
  shape: import('../core/types.js').Shape;
  page?: Page;
  job: Job;
}

export interface Contribution {
  operations?: readonly DraftOp[];
  binds?: readonly Bind[];
  support?: SupportMap;
}

export interface Feature {
  id: string;
  rev?: string;
  requires?: readonly string[];
  build(context: BuildContext): Contribution;
}

export interface CatalogPort {
  readonly id: string;
  readonly hash: import('../core/types.js').Hash;
  resolve(ref: import('../core/types.js').ShapeRef): { shape: import('../core/types.js').Shape; features: readonly Feature[] };
}

export interface BlockRule {
  op: DraftOp['op'];
  target?: Ref;
  key?: Key;
  part?: FnPart;
  reason: string;
}

export interface EngineManifest {
  id: string;
  hash: string;
  blocked: BlockRule[];
}

export interface CompileInput {
  profile: Profile;
  shape?: ShapeRef;
  synthetic?: boolean;
  page?: Page;
  job: Job;
  catalog: CatalogPort;
  engine: EngineManifest;
  drivers: readonly string[];
  require?: SupportMap;
}
