export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
declare const hashBrand: unique symbol;
export type Hash = string & { readonly [hashBrand]: true };

export type Phase = 'parse' | 'compile' | 'install' | 'run' | 'encode';

export type ErrorCode =
  | 'BAD_JOB'
  | 'BAD_COLLECT'
  | 'BAD_PROFILE'
  | 'BAD_PAGE'
  | 'BAD_SHAPE'
  | 'BAD_PLAN'
  | 'BAD_RESULT'
  | 'FEATURE_CYCLE'
  | 'DUPLICATE_FEATURE'
  | 'NO_FEATURE'
  | 'WRITE_CONFLICT'
  | 'NO_DRIVER'
  | 'LOW_SUPPORT'
  | 'SYNTHETIC_REQUIRED'
  | 'ENGINE_BLOCKED'
  | 'INSTALL_FAILED'
  | 'RUN_FAILED'
  | 'ENCODE_FAILED'
  | 'LEGACY_PATH'
  | 'LEGACY_PARENT'
  | 'LEGACY_CYCLE'
  | 'LEGACY_NAME'
  | 'LEGACY_TRAITS'
  | 'LEGACY_ENGINE';

export type Support = 'captured' | 'derived' | 'emulated' | 'shape-only' | 'unsupported';

export type Host = 'chrome' | 'webview';
export type Platform = 'android' | 'linux' | 'macos' | 'windows';
export type Form = 'desktop' | 'mobile';

export interface ShapeRef {
  id: string;
  hash: Hash;
}

export interface Target {
  engine: 'chromium';
  host: Host;
  platform: Platform;
  form: Form;
  version: number;
}

export interface Shape {
  schema: 2;
  id: string;
  hash: Hash;
  target: Target;
  level: 'captured' | 'derived';
  source: Source;
  features: string[];
  ops: JsonValue[];
  support: SupportMap;
}

export interface CatalogDoc {
  schema: 2;
  id: string;
  hash: Hash;
  shapes: Shape[];
}

export type Source =
  | { kind: 'capture' | 'fp-env' | 'manual'; hash: Hash; file?: string }
  | { kind: 'derived'; hash: Hash; rule: string; base?: ShapeRef };

export type Data = Record<string, JsonValue>;

export interface Brand {
  brand: string;
  version: string;
}

export interface UaData {
  brands: Brand[];
  mobile: boolean;
  platform: string;
  architecture: string;
  bitness: string;
  fullVersionList: Brand[];
  model: string;
  platformVersion: string;
  uaFullVersion: string;
  wow64: boolean;
}

export interface NavigatorData {
  userAgent: string;
  appVersion: string;
  platform: string;
  vendor: string;
  language: string;
  languages: string[];
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
  cookieEnabled: boolean;
  userAgentData: UaData;
}

export interface Orientation {
  type: string;
  angle: number;
}

export interface ScreenData {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  availLeft: number;
  availTop: number;
  colorDepth: number;
  pixelDepth: number;
  orientation: Orientation;
}

export interface WindowData {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  devicePixelRatio: number;
}

export interface TimezoneData {
  timeZone: string;
  offset: number;
}

export type GlValue = JsonPrimitive | JsonPrimitive[];

export interface Precision {
  rangeMin: number;
  rangeMax: number;
  precision: number;
}

export interface WebGlData {
  parameters: Record<string, GlValue>;
  extensions: string[];
  unmaskedVendor: string;
  unmaskedRenderer: string;
  shaderPrecision?: Record<string, Precision>;
}

export type Part = 'navigator' | 'screen' | 'window' | 'timezone' | 'webgl' | 'canvas' | 'audio' | 'fonts';

export interface Evidence {
  support: Support;
  fields: Record<string, Support>;
  source: Source;
}

export interface Profile {
  schema: 2;
  id: string;
  hash: Hash;
  target: Target;
  shape: ShapeRef;
  source: Source;
  navigator: NavigatorData;
  screen: ScreenData;
  window?: WindowData;
  timezone?: TimezoneData;
  webgl?: WebGlData;
  evidence: Record<Part, Evidence>;
}

export interface Connection {
  effectiveType: string;
  downlink: number;
  rtt: number;
  saveData: boolean;
  /** Network Information API `type` (wifi, cellular, …); optional for older profiles. */
  type?: string;
}

export interface Clock {
  now: number;
  seed: number;
}

export interface PerformanceResource {
  name: string;
  initiatorType: string;
  startTime: number;
  duration: number;
  nextHopProtocol: string;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  responseStatus: number;
}

export interface PagePerformance {
  resources: PerformanceResource[];
}

export interface Page {
  schema: 2;
  id: string;
  hash: Hash;
  source: Source;
  url?: string;
  html?: string;
  cookies?: string[];
  connection?: Connection;
  clock?: Clock;
  performance?: PagePerformance;
}

interface ScriptJob {
  kind: 'run' | 'capture' | 'diagnose';
  code: string;
  scriptUrl?: string;
  trace?: boolean;
  timeout?: number;
}

interface ProbeJob {
  kind: 'probe';
  timeout?: number;
}

export type Job = ScriptJob | ProbeJob;

export type ParseIssue = {
  [key: string]: JsonValue;
  path: string;
  rule: string;
  message: string;
};

export type SupportMap = Record<string, Support>;

export interface Bind {
  readonly slot: string;
  readonly driver: string;
  readonly config?: JsonValue;
  readonly sources?: readonly string[];
}

export interface Boot {
  readonly url: string;
  readonly html: string;
  readonly cookies: readonly string[];
}

export interface Plan<Operation = JsonValue, Binding extends Bind = Bind> {
  readonly schema: 2;
  readonly id: string;
  readonly synthetic?: true;
  readonly profile: Readonly<{ id: string; hash: string }>;
  readonly shape: Readonly<{ id: string; hash: Hash; level: Shape['level'] }>;
  readonly page?: Readonly<{ id: string; hash: string }>;
  readonly boot: Boot;
  readonly task: Job['kind'];
  readonly engine: Readonly<{ id: string; hash: string }>;
  readonly catalog: Readonly<{ id: string; hash: Hash }>;
  readonly features: readonly string[];
  readonly operations: readonly Operation[];
  readonly binds: readonly Binding[];
  readonly support: Readonly<SupportMap>;
}

export interface ErrorInfo {
  name: 'MimicError';
  phase: Phase;
  code: ErrorCode;
  message: string;
  details?: JsonValue;
  plan?: string;
}

export type Result<Value = JsonValue> =
  | { ok: true; value?: Value; report?: Data; plan: string; support: SupportMap; synthetic?: true }
  | { ok: false; error: ErrorInfo; report?: Data; plan?: string; support?: SupportMap; synthetic?: true };
