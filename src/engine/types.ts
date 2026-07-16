import type { Data, JsonValue, Plan } from '../core/types.js';
import type { Op, PlanBind } from '../shape/types.js';

export interface Port {
  node(id: string): unknown;
  make(protoNode: string): unknown;
  clone(value: JsonValue): unknown;
  source(path: string): unknown;
  error(name: 'Error' | 'TypeError' | 'RangeError', message: string): Error;
  resolve(value?: JsonValue): Promise<unknown>;
  record(value: JsonValue): void;
  /** Evaluate source in this installer's window realm (iframe-safe). */
  evaluate(source: string): unknown;
  realm(): number;
  now(): number;
  origin(): number;
}

export interface DriverInstance {
  call?(config: JsonValue | undefined, self: unknown, args: readonly unknown[]): unknown;
  construct?(config: JsonValue | undefined, args: readonly unknown[], newTarget: Function): unknown;
  report?(): JsonValue;
  close?(): void;
}

export interface Driver {
  open(port: Port): DriverInstance;
}

export type Drivers = Readonly<Record<string, Driver>>;

export type RuntimeResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; stack?: string };

export interface Runtime {
  readonly plan: Plan<Op, PlanBind>;
  run(code: string, options?: { timeout?: number; url?: string }): RuntimeResult;
  report(): Data;
  dispose(): void;
}

export interface Engine {
  readonly manifest: import('../shape/types.js').EngineManifest;
  open(plan: Plan<Op, PlanBind>, drivers?: Drivers): Runtime;
}
