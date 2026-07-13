export { MimicError } from './core/error.js';
export { digest, seal } from './core/seal.js';
export { parseCatalog, parseJob, parsePage, parseProfile, parseShape } from './core/parse.js';
export { encodeResult, parseResult } from './core/result.js';
export { Catalog } from './catalog/index.js';
export { LegacyProfiles } from './legacy/profiles.js';
export type { ImportedProfile, LedgerEntry, MigrationReport } from './legacy/profiles.js';
export { compile, explain } from './compile/index.js';
export { parsePlan } from './compile/parse.js';
export type { PlanExplanation } from './compile/index.js';
export type {
  BlockRule,
  BuildContext,
  CompileInput,
  CatalogPort,
  Contribution,
  Desc,
  DraftOp,
  EngineManifest,
  Feature,
  FnPart,
  FnShape,
  Key,
  Op,
  PlanBind,
  Ref,
  StoredValue,
} from './shape/types.js';
export { JsdomEngine } from './engines/jsdom.js';
export type { Driver, DriverInstance, Drivers, Engine, Port, Runtime, RuntimeResult } from './engine/types.js';
export type {
  Data,
  CatalogDoc,
  Bind,
  Boot,
  ErrorCode,
  ErrorInfo,
  Form,
  Hash,
  Host,
  Job,
  JsonValue,
  Page,
  Part,
  ParseIssue,
  Phase,
  Platform,
  Plan,
  Profile,
  Result,
  Shape,
  ShapeRef,
  Source,
  Target,
  Support,
  SupportMap,
} from './core/types.js';
