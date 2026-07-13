import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { CookieJar, JSDOM } from 'jsdom';
import packageJSON from '../../../package.json' with { type: 'json' };
import { MimicError } from '../core/error.js';
import { deepFreeze, jsonCopy } from '../core/json.js';
import type { Data, JsonValue, Plan } from '../core/types.js';
import type { DriverInstance, Drivers, Engine, Port, Runtime, RuntimeResult } from '../engine/types.js';
import type { Desc, EngineManifest, FnShape, Key, Op, PlanBind, Ref, StoredValue } from '../shape/types.js';
import { parsePlan } from '../compile/parse.js';

type BrowserWindow = Window & typeof globalThis;
type Callable = (...args: unknown[]) => unknown;
type FunctionOp = Extract<Op, { op: 'alloc'; kind: 'function' }>;
type ShapeOp = Extract<Op, { op: 'fn' }>;

interface FunctionProperty {
  owner: object;
  key: string | symbol;
  part: 'value' | 'get' | 'set';
  desc: PropertyDescriptor;
  value: Callable;
}

interface Bound {
  instance: DriverInstance;
  config?: JsonValue;
}

const refName = (ref: Ref): string => ('path' in ref ? `path:${ref.path}` : `node:${ref.node}`);

class JsdomRuntime implements Runtime {
  readonly plan: Plan<Op, PlanBind>;
  private context: vm.Context | null;
  private closeWindow: (() => void) | null;
  private closeInstall: (() => void) | null;
  private readInstall: (() => Data) | null;
  private onDispose: (() => void) | null;
  private disposed = false;

  constructor(
    context: vm.Context,
    closeWindow: () => void,
    plan: Plan<Op, PlanBind>,
    closeInstall: () => void,
    readInstall: () => Data,
    onDispose: () => void,
  ) {
    this.plan = plan;
    this.context = context;
    this.closeWindow = closeWindow;
    this.closeInstall = closeInstall;
    this.readInstall = readInstall;
    this.onDispose = onDispose;
  }

  run(code: string, options: { timeout?: number; url?: string } = {}): RuntimeResult {
    if (this.disposed) throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: 'Runtime 已 dispose' });
    try {
      const value = vm.runInContext(code, this.context!, {
        filename: options.url || this.plan.boot.url,
        ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      });
      return { ok: true, value };
    } catch (error) {
      const value = error as { message?: unknown; stack?: unknown } | null;
      const message = value && typeof value.message === 'string' ? value.message : String(error);
      const stack = value && typeof value.stack === 'string' ? value.stack : undefined;
      return { ok: false, error: message, ...(stack ? { stack } : {}) };
    }
  }

  report(): Data {
    if (this.disposed) throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: 'Runtime 已 dispose' });
    return this.readInstall!();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const closeInstall = this.closeInstall;
    const closeWindow = this.closeWindow;
    const onDispose = this.onDispose;
    this.context = null;
    this.closeInstall = null;
    this.readInstall = null;
    this.closeWindow = null;
    this.onDispose = null;
    let first: unknown;
    try {
      closeInstall?.();
    } catch (error) {
      first = error;
    } finally {
      try {
        closeWindow?.();
      } catch (error) {
        first ??= error;
      } finally {
        onDispose?.();
      }
    }
    if (first) throw first;
  }
}

class Installer {
  private readonly window: BrowserWindow;
  private readonly plan: Plan<Op, PlanBind>;
  private readonly drivers: Drivers;
  private readonly nodes = new Map<string, unknown>();
  private readonly trusted = new WeakSet<object>();
  private readonly binds = new Map<string, Bound>();
  private readonly nativeFunctions = new WeakMap<Function, string>();
  private readonly resolved = new Map<string, unknown>();
  private readonly resolvedKeys = new Map<string, string | symbol>();
  private readonly instances = new Map<string, DriverInstance>();
  private readonly opened: DriverInstance[] = [];
  private readonly sources = new Map<string, unknown>();
  private readonly timeOrigin: number;
  private closed = false;

  constructor(window: BrowserWindow, plan: Plan<Op, PlanBind>, drivers: Drivers) {
    this.window = window;
    this.plan = plan;
    this.drivers = drivers;
    this.timeOrigin = window.performance.timeOrigin;
  }

  install(): void {
    this.captureSources();
    for (const operation of this.plan.operations) {
      if (operation.op === 'alloc' && operation.kind !== 'function') this.allocate(operation);
    }
    for (const operation of this.plan.operations) {
      if (operation.op === 'alloc' && operation.kind === 'function') this.allocate(operation);
    }
    this.prepare();
    this.preflight();
    this.bootNativeToString();
    for (const operation of this.plan.operations) this.apply(operation);
    this.openDrivers();
  }

  private captureSources(): void {
    for (const bind of this.plan.binds) {
      for (const path of bind.sources || []) {
        if (this.sources.has(path)) continue;
        const value = this.readSource(path);
        if (value !== null && typeof value === 'object') {
          throw new MimicError({
            phase: 'install', code: 'BAD_PLAN', message: `Engine source 只能是值或函数:${path}`, plan: this.plan.id,
          });
        }
        this.sources.set(path, value);
      }
    }
  }

  private readSource(path: string): unknown {
    const parts = path.split('.');
    if (parts.shift() !== 'window') {
      throw new MimicError({ phase: 'install', code: 'BAD_PLAN', message: `非法 Engine source:${path}`, plan: this.plan.id });
    }
    let value: unknown = this.window;
    for (const part of parts) {
      if ((typeof value !== 'object' && typeof value !== 'function') || value === null || !(part in value)) return undefined;
      value = Reflect.get(value, part);
    }
    return value;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    let first: unknown;
    for (const instance of this.opened.slice().reverse()) {
      try {
        instance.close?.();
      } catch (error) {
        first ??= error;
      }
    }
    this.opened.length = 0;
    this.instances.clear();
    this.binds.clear();
    this.nodes.clear();
    this.resolved.clear();
    this.resolvedKeys.clear();
    this.sources.clear();
    if (first) throw first;
  }

  report(): Data {
    if (this.closed) throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: 'Installer 已关闭' });
    const output: Data = {};
    for (const [id, instance] of this.instances) {
      if (!instance.report) continue;
      try {
        Object.defineProperty(output, id, {
          value: jsonCopy(instance.report()),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } catch (cause) {
        throw new MimicError({
          phase: 'run', code: 'RUN_FAILED', message: `Driver report 失败:${id}`,
          details: { driver: id }, plan: this.plan.id, cause,
        });
      }
    }
    return output;
  }

  private prepare(): void {
    for (const operation of this.plan.operations) {
      if (operation.op === 'alloc') continue;
      this.resolve(operation.target);
      if (operation.op === 'proto' && operation.value) this.resolve(operation.value);
      if (operation.op === 'prop') {
        this.key(operation.key);
        if (operation.desc.kind === 'data' && 'ref' in operation.desc.value) this.resolve(operation.desc.value.ref);
        if (operation.desc.kind === 'accessor') {
          if (operation.desc.get) this.resolve(operation.desc.get);
          if (operation.desc.set) this.resolve(operation.desc.set);
        }
      }
      if (operation.op === 'drop') this.key(operation.key);
      if (operation.op === 'fn' && operation.key !== undefined) this.key(operation.key);
      if (operation.op === 'order') for (const key of operation.keys) this.key(key);
    }
  }

  private openDrivers(): void {
    const access = new Map<string, Set<string>>();
    for (const bind of this.plan.binds) {
      let paths = access.get(bind.driver);
      if (!paths) {
        paths = new Set();
        access.set(bind.driver, paths);
      }
      for (const path of bind.sources || []) paths.add(path);
    }
    const port = (driver: string): Port => ({
      node: (id) => {
        if (!this.nodes.has(id)) throw new MimicError({ phase: 'install', code: 'BAD_PLAN', message: `Driver 请求未知 node:${id}` });
        return this.nodes.get(id);
      },
      make: (protoNode) => {
        if (typeof protoNode !== 'string' || !this.nodes.has(protoNode)) {
          throw new MimicError({ phase: 'install', code: 'BAD_PLAN', message: `Driver 请求未知 proto node:${protoNode}` });
        }
        const prototype = this.nodes.get(protoNode);
        if ((typeof prototype !== 'object' && typeof prototype !== 'function') || prototype === null) {
          throw new MimicError({ phase: 'install', code: 'BAD_PLAN', message: `Driver 请求非对象 proto node:${protoNode}` });
        }
        const value = this.window.Object.create(prototype) as object;
        this.trusted.add(value);
        return value;
      },
      clone: (value) => this.value({ json: value }),
      source: (path) => {
        if (!access.get(driver)?.has(path) || !this.sources.has(path)) {
          throw new MimicError({ phase: 'install', code: 'INSTALL_FAILED', message: `Driver ${driver} 未声明 Engine source:${path}` });
        }
        return this.sources.get(path);
      },
      error: (name, message) => new this.window[name](message),
      resolve: (value) => this.window.Promise.resolve(value === undefined ? undefined : this.value({ json: value })),
      now: () => this.window.Date.now(),
      origin: () => this.timeOrigin,
    });
    for (const bind of this.plan.binds) {
      let instance = this.instances.get(bind.driver);
      if (!instance) {
        const driver = this.drivers[bind.driver];
        if (!driver) throw new MimicError({ phase: 'install', code: 'NO_DRIVER', message: `Runtime 缺少 Driver:${bind.driver}` });
        instance = driver.open(port(bind.driver));
        if (instance === null || typeof instance !== 'object') {
          throw new MimicError({ phase: 'install', code: 'INSTALL_FAILED', message: `Driver.open 必须返回对象:${bind.driver}` });
        }
        this.instances.set(bind.driver, instance);
        this.opened.push(instance);
      }
      this.binds.set(bind.slot, { instance, ...(bind.config === undefined ? {} : { config: bind.config }) });
    }
  }

  private bootNativeToString(): void {
    const original = this.window.Function.prototype.toString;
    const nativeFunctions = this.nativeFunctions;
    const target = this.window.eval('({toString(){}}).toString') as Callable;
    const nativeToString = new this.window.Proxy(target, {
      apply(_target, thisArg) {
        const source = typeof thisArg === 'function' ? nativeFunctions.get(thisArg) : undefined;
        return source ?? original.call(thisArg);
      },
    });
    this.nativeFunctions.set(nativeToString, 'function toString() { [native code] }');
    Object.defineProperty(this.window.Function.prototype, 'toString', {
      value: nativeToString,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }

  private allocate(operation: Extract<Op, { op: 'alloc' }>): void {
    if (operation.kind === 'object') {
      this.store(operation.id, this.window.Object.create(this.window.Object.prototype));
      return;
    }
    if (operation.kind === 'event') {
      const target = new this.window.EventTarget();
      const hidden = new Set(Reflect.ownKeys(target));
      const event = new this.window.Proxy(target, {
        ownKeys: (value) => Reflect.ownKeys(value).filter((key) => !hidden.has(key)),
      });
      this.store(operation.id, event);
      return;
    }
    if (operation.kind === 'proxy') {
      const source = this.resolve(operation.source) as unknown;
      if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
        this.block(operation, 'proxy source is not an object');
      }
      const hidden = new Set(Reflect.ownKeys(source).filter((key) => (
        typeof key === 'symbol' && operation.symbols.includes(key.description || '')
      )));
      if (hidden.size !== operation.symbols.length) this.block(operation, 'proxy symbol description is missing or ambiguous');
      for (const key of hidden) {
        if (!Object.getOwnPropertyDescriptor(source, key)?.configurable) this.block(operation, 'proxy cannot hide non-configurable symbol');
      }
      const proxy = new this.window.Proxy(source, {
        ownKeys: (value) => Reflect.ownKeys(value).filter((key) => !hidden.has(key)),
      });
      this.store(operation.id, proxy);
      return;
    }
    this.store(operation.id, this.createFunction(operation));
  }

  private store(id: string, value: object): void {
    this.nodes.set(id, value);
    this.trusted.add(value);
  }

  private createFunction(operation: FunctionOp): Callable {
    const invoke = (self: unknown, args: unknown[], newTarget?: Function): unknown => {
      if (operation.slot === undefined) return undefined;
      const bound = this.binds.get(operation.slot);
      if (!bound) throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: `Driver slot 未绑定:${operation.slot}` });
      try {
        if (newTarget) {
          const result = bound.instance.construct?.(bound.config, args, newTarget);
          if ((typeof result === 'object' && result !== null) || typeof result === 'function') return this.realmValue(result);
          const candidate = (newTarget as { prototype?: unknown }).prototype;
          const prototype = candidate !== null && (typeof candidate === 'object' || typeof candidate === 'function')
            ? candidate
            : this.window.Object.prototype;
          return this.window.Object.create(prototype);
        }
        return this.realmValue(bound.instance.call?.(bound.config, self, args));
      } catch (error) {
        if (error instanceof this.window.Error) throw error;
        const value = error as { message?: unknown } | null;
        throw new this.window.Error(value && typeof value.message === 'string' ? value.message : String(error));
      }
    };

    const base = operation.shape.constructable
      ? this.window.eval('(function(){}).bind(undefined)') as Callable
      : this.window.eval('({call(){}}).call') as Callable;
    let callable: Callable;
    const handler: ProxyHandler<Callable> = {
      apply: (_target, thisArg, args) => invoke(thisArg, args),
      ...(operation.shape.constructable ? {
        construct: (_target: Callable, args: unknown[], newTarget: Function) => invoke(undefined, args, newTarget) as object,
      } : {}),
    };
    callable = new this.window.Proxy(base, handler) as Callable;
    if (operation.shape.hasPrototype) {
      Object.defineProperty(callable, 'prototype', {
        value: operation.prototype ? this.resolve(operation.prototype) : this.window.Object.create(this.window.Object.prototype),
        writable: false,
        enumerable: false,
        configurable: false,
      });
    }
    Object.defineProperty(callable, 'name', { value: operation.shape.name, configurable: true });
    Object.defineProperty(callable, 'length', { value: operation.shape.length, configurable: true });
    if (operation.shape.native) {
      this.nativeFunctions.set(callable, `function ${operation.shape.name}() { [native code] }`);
    }
    const keys = Reflect.ownKeys(callable);
    if (keys.length !== operation.shape.keys.length || keys.some((key, index) => key !== operation.shape.keys[index])) {
      this.block(operation, `function own keys mismatch:${keys.map(String).join(',')}`);
    }
    return callable;
  }

  private realmValue(value: unknown): unknown {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (value instanceof this.window.Object || this.trusted.has(value)) return value;
    throw new this.window.TypeError('Driver returned a foreign Realm object');
  }

  private preflight(): void {
    for (const operation of this.plan.operations) {
      if (operation.op === 'drop') {
        const target = this.resolve(operation.target);
        const descriptor = Object.getOwnPropertyDescriptor(target, this.key(operation.key));
        if (descriptor && !descriptor.configurable) this.block(operation, 'non-configurable property');
      } else if (operation.op === 'prop') {
        const target = this.resolve(operation.target);
        const descriptor = Object.getOwnPropertyDescriptor(target, this.key(operation.key));
        if (descriptor && !descriptor.configurable) this.block(operation, 'non-configurable property');
      } else if (operation.op === 'proto') {
        const target = this.resolve(operation.target);
        if ((typeof target !== 'object' && typeof target !== 'function') || target === null || !Object.isExtensible(target)) {
          this.block(operation, 'prototype target is not extensible');
        }
      } else if (operation.op === 'fn') {
        const property = this.functionProperty(operation);
        const target = property?.value ?? this.resolve(operation.target);
        if (typeof target !== 'function') this.block(operation, 'fn target is not callable');
        if (property && !this.sameFunctionShape(target, operation.shape)) {
          const replaceable = property.part === 'value'
            ? property.desc.configurable || property.desc.writable
            : property.desc.configurable;
          if (!replaceable) this.block(operation, 'function property cannot be replaced');
        }
      } else if (operation.op === 'order') {
        const target = this.resolve(operation.target);
        const actual = Reflect.ownKeys(target);
        const wanted = operation.keys.map((key) => this.key(key));
        const sameSet = actual.length === wanted.length && actual.every((key) => wanted.includes(key));
        const already = actual.every((key, index) => key === wanted[index]);
        if (sameSet && !already && actual.some((key) => !Object.getOwnPropertyDescriptor(target, key)?.configurable)
          && !this.canRebuildPrototype(target)) {
          this.block(operation, 'non-configurable key cannot be reordered');
        }
      }
    }
  }

  private constructable(value: Function): boolean {
    try {
      Reflect.construct(this.window.Object, [], value);
      return true;
    } catch {
      return false;
    }
  }

  private sameFunctionShape(value: Function, shape: FnShape): boolean {
    const keys = Reflect.ownKeys(value);
    return Object.hasOwn(value, 'prototype') === shape.hasPrototype
      && this.constructable(value) === shape.constructable
      && keys.length === shape.keys.length
      && keys.every((key, index) => key === shape.keys[index]);
  }

  private block(operation: Op, reason: string): never {
    throw new MimicError({
      phase: 'install',
      code: 'ENGINE_BLOCKED',
      message: `jsdom 无法安装 ${operation.op}:${reason}`,
      details: { feature: operation.feature, target: operation.op === 'alloc' ? operation.id : refName(operation.target), reason },
      plan: this.plan.id,
    });
  }

  private apply(operation: Op): void {
    switch (operation.op) {
      case 'alloc': return;
      case 'proto':
        Object.setPrototypeOf(this.resolve(operation.target), operation.value === null ? null : this.resolve(operation.value));
        return;
      case 'prop':
        Object.defineProperty(this.resolve(operation.target), this.key(operation.key), this.descriptor(operation.desc));
        return;
      case 'drop':
        Reflect.deleteProperty(this.resolve(operation.target), this.key(operation.key));
        return;
      case 'fn':
        this.applyFunction(operation);
        return;
      case 'order':
        this.applyOrder(operation);
        return;
    }
  }

  private applyFunction(operation: ShapeOp): void {
    const property = this.functionProperty(operation);
    let target = property?.value ?? this.resolve(operation.target);
    if (typeof target !== 'function') this.block(operation, 'fn target is not callable');
    if (!this.sameFunctionShape(target, operation.shape)) {
      if (!property) this.block(operation, 'direct function internal shape cannot be changed');
      target = this.forward(target, operation.shape);
      const desc = { ...property.desc };
      if (property.part === 'value') desc.value = target;
      else desc[property.part] = target;
      Object.defineProperty(property.owner, property.key, desc);
    }
    this.normalizeFunction(target, operation.shape, operation);
  }

  private functionProperty(operation: ShapeOp): FunctionProperty | undefined {
    if (operation.key === undefined || operation.part === undefined) return undefined;
    const owner = this.resolve(operation.target) as unknown;
    if ((typeof owner !== 'object' && typeof owner !== 'function') || owner === null) {
      this.block(operation, 'fn owner is not an object');
    }
    const key = this.key(operation.key);
    const desc = Object.getOwnPropertyDescriptor(owner, key);
    if (!desc) this.block(operation, 'fn property is missing');
    const value = operation.part === 'value' ? desc.value : desc[operation.part];
    if (typeof value !== 'function') this.block(operation, `fn ${operation.part} is not callable`);
    return { owner, key, part: operation.part, desc, value };
  }

  private forward(source: Callable, shape: FnShape): Callable {
    const base = shape.constructable
      ? this.window.eval('(function(){}).bind(undefined)') as Callable
      : this.window.eval('({call(){}}).call') as Callable;
    const handler: ProxyHandler<Callable> = {
      apply: (_target, self, args) => Reflect.apply(source, self, args),
      ...(shape.constructable ? {
        construct: (_target: Callable, args: unknown[], newTarget: Function) => Reflect.construct(source, args, newTarget),
      } : {}),
    };
    const target = new this.window.Proxy(base, handler) as Callable;
    Object.setPrototypeOf(target, Object.getPrototypeOf(source));
    if (shape.hasPrototype) {
      const prototype = Object.hasOwn(source, 'prototype')
        ? (source as { prototype?: unknown }).prototype
        : this.window.Object.create(this.window.Object.prototype);
      Object.defineProperty(target, 'prototype', {
        value: prototype,
        writable: false,
        enumerable: false,
        configurable: false,
      });
    }
    return target;
  }

  private normalizeFunction(target: Callable, shape: FnShape, operation: ShapeOp): void {
    if (!(target instanceof this.window.Function)) Object.setPrototypeOf(target, this.window.Function.prototype);
    if (!(target instanceof this.window.Function)) this.block(operation, 'function Realm prototype mismatch');
    Object.defineProperty(target, 'name', { value: shape.name, configurable: true });
    Object.defineProperty(target, 'length', { value: shape.length, configurable: true });
    if (shape.native) this.nativeFunctions.set(target, `function ${shape.name}() { [native code] }`);
    const keys = Reflect.ownKeys(target);
    if (keys.length !== shape.keys.length || keys.some((key, index) => key !== shape.keys[index])) {
      this.block(operation, `function own keys mismatch:${keys.map(String).join(',')}`);
    }
  }

  private applyOrder(operation: Extract<Op, { op: 'order' }>): void {
    const target = this.resolve(operation.target);
    const actual = Reflect.ownKeys(target);
    const wanted = operation.keys.map((key) => this.key(key));
    const sameSet = actual.length === wanted.length && actual.every((key) => wanted.includes(key));
    if (!sameSet) {
      const missing = wanted.filter((key) => !actual.includes(key)).slice(0, 8).map(String);
      const extra = actual.filter((key) => !wanted.includes(key)).slice(0, 8).map(String);
      this.block(operation, `order key set mismatch;missing=${missing.join(',')};extra=${extra.join(',')}`);
    }
    if (actual.some((key) => !Object.getOwnPropertyDescriptor(target, key)?.configurable)) {
      const already = actual.every((key, index) => key === wanted[index]);
      if (!already) {
        this.rebuildPrototype(operation, target, wanted);
        return;
      }
      return;
    }
    const descriptors = new Map<string | symbol, PropertyDescriptor>(
      actual.map((key) => [key, Object.getOwnPropertyDescriptor(target, key)!]),
    );
    for (const key of actual) Reflect.deleteProperty(target, key);
    for (const key of wanted) Object.defineProperty(target, key, descriptors.get(key)!);
    const result = Reflect.ownKeys(target);
    if (result.some((key, index) => key !== wanted[index])) this.block(operation, 'ECMAScript key order restriction');
  }

  private prototypeSource(target: object): { source: Callable; name: string; desc: PropertyDescriptor } | undefined {
    const constructor = Object.getOwnPropertyDescriptor(target, 'constructor')?.value;
    if (typeof constructor !== 'function' || constructor.prototype !== target || typeof constructor.name !== 'string' || !constructor.name) {
      return undefined;
    }
    const desc = Object.getOwnPropertyDescriptor(this.window, constructor.name);
    if (!desc || desc.value !== constructor || (!desc.configurable && !desc.writable)) return undefined;
    return { source: constructor, name: constructor.name, desc };
  }

  private canRebuildPrototype(target: unknown): target is object {
    if ((typeof target !== 'object' && typeof target !== 'function') || target === null || !this.prototypeSource(target)
      || !this.constructorRegistry()) return false;
    for (const key of Reflect.ownKeys(this.window)) {
      const value = Object.getOwnPropertyDescriptor(this.window, key)?.value;
      if (typeof value !== 'function' || !Object.hasOwn(value, 'prototype')) continue;
      const prototype = (value as { prototype?: unknown }).prototype;
      if ((typeof prototype === 'object' || typeof prototype === 'function') && prototype !== null
        && Object.getPrototypeOf(prototype) === target && !Object.isExtensible(prototype)) return false;
    }
    return true;
  }

  private rebuildPrototype(operation: Extract<Op, { op: 'order' }>, target: object, wanted: readonly (string | symbol)[]): void {
    const info = this.prototypeSource(target);
    const registry = this.constructorRegistry();
    if (!info || !registry || !this.canRebuildPrototype(target)) this.block(operation, 'prototype cannot be rebuilt');
    const next = this.window.Object.create(Object.getPrototypeOf(target)) as object;
    const wrapper = this.wrapConstructor(info.source, next);
    for (const key of wanted) {
      const desc = Object.getOwnPropertyDescriptor(target, key);
      if (!desc) this.block(operation, 'prototype descriptor is missing');
      Object.defineProperty(next, key, key === 'constructor' ? { ...desc, value: wrapper } : desc);
    }
    for (const key of Reflect.ownKeys(this.window)) {
      const value = Object.getOwnPropertyDescriptor(this.window, key)?.value;
      if (typeof value !== 'function' || !Object.hasOwn(value, 'prototype')) continue;
      const prototype = (value as { prototype?: unknown }).prototype;
      if ((typeof prototype === 'object' || typeof prototype === 'function') && prototype !== null
        && Object.getPrototypeOf(prototype) === target) {
        Object.setPrototypeOf(prototype, next);
        Object.setPrototypeOf(value, wrapper);
      }
    }
    Object.defineProperty(this.window, info.name, { ...info.desc, value: wrapper });
    Object.defineProperty(registry, info.name, {
      ...Object.getOwnPropertyDescriptor(registry, info.name),
      value: wrapper,
    });
    const source = this.nativeFunctions.get(info.source);
    if (source) this.nativeFunctions.set(wrapper, source);
    if ('path' in operation.target) {
      this.resolved.set(`path:${operation.target.path}`, next);
      this.resolved.set(`path:window.${info.name}`, wrapper);
      this.resolved.set(`path:window.${info.name}.prototype`, next);
    }
  }

  private constructorRegistry(): object | undefined {
    for (const key of Object.getOwnPropertySymbols(this.window)) {
      if (key.description !== '[webidl2js] constructor registry') continue;
      const value = Reflect.get(this.window, key) as unknown;
      if ((typeof value === 'object' || typeof value === 'function') && value !== null) return value;
    }
    return undefined;
  }

  private wrapConstructor(source: Callable, prototype: object): Callable {
    const base = this.window.eval('(function(){}).bind(undefined)') as Callable;
    const wrapper = new this.window.Proxy(base, {
      apply: (_target, self, args) => Reflect.apply(source, self, args),
      construct: (_target: Callable, args: unknown[], newTarget: Function) => Reflect.construct(source, args, newTarget),
    }) as Callable;
    Object.setPrototypeOf(wrapper, Object.getPrototypeOf(source));
    Object.defineProperty(wrapper, 'name', { value: source.name, configurable: true });
    Object.defineProperty(wrapper, 'length', { value: source.length, configurable: true });
    const prototypeDesc = Object.getOwnPropertyDescriptor(source, 'prototype');
    if (!prototypeDesc) throw new TypeError(`Interface constructor has no prototype:${source.name}`);
    Object.defineProperty(wrapper, 'prototype', { ...prototypeDesc, value: prototype });
    for (const key of Reflect.ownKeys(source)) {
      if (key === 'length' || key === 'name' || key === 'prototype') continue;
      Object.defineProperty(wrapper, key, Object.getOwnPropertyDescriptor(source, key)!);
    }
    return wrapper;
  }

  private resolve(ref: Ref): any {
    const cacheKey = 'node' in ref ? `node:${ref.node}` : `path:${ref.path}`;
    if (this.resolved.has(cacheKey)) return this.resolved.get(cacheKey);
    if ('node' in ref) {
      if (!this.nodes.has(ref.node)) throw new MimicError({ phase: 'install', code: 'BAD_PLAN', message: `未知 node:${ref.node}`, plan: this.plan.id });
      const node = this.nodes.get(ref.node);
      this.resolved.set(cacheKey, node);
      return node;
    }
    const parts = ref.path.split('.');
    if (parts.shift() !== 'window') throw new MimicError({ phase: 'install', code: 'BAD_PLAN', message: `非法 path:${ref.path}`, plan: this.plan.id });
    let value: any = this.window;
    for (const part of parts) {
      if (value == null || !(part in value)) throw new MimicError({ phase: 'install', code: 'BAD_PLAN', message: `无法解析 path:${ref.path}`, plan: this.plan.id });
      value = value[part];
    }
    this.resolved.set(cacheKey, value);
    return value;
  }

  private key(key: Key): string | symbol {
    const cacheKey = JSON.stringify(key);
    const cached = this.resolvedKeys.get(cacheKey);
    if (cached !== undefined) return cached;
    if (typeof key === 'string') {
      this.resolvedKeys.set(cacheKey, key);
      return key;
    }
    if (key.symbol.startsWith('for:')) {
      const symbol = this.window.Symbol.for(key.symbol.slice(4));
      this.resolvedKeys.set(cacheKey, symbol);
      return symbol;
    }
    const symbol = (this.window.Symbol as unknown as Record<string, unknown>)[key.symbol];
    if (typeof symbol !== 'symbol') throw new MimicError({ phase: 'install', code: 'BAD_PLAN', message: `未知 Symbol:${key.symbol}`, plan: this.plan.id });
    this.resolvedKeys.set(cacheKey, symbol);
    return symbol;
  }

  private descriptor(desc: Desc): PropertyDescriptor {
    if (desc.kind === 'data') {
      return {
        value: this.value(desc.value),
        writable: desc.writable,
        enumerable: desc.enumerable,
        configurable: desc.configurable,
      };
    }
    return {
      ...(desc.get === undefined ? {} : { get: this.resolve(desc.get) }),
      ...(desc.set === undefined ? {} : { set: this.resolve(desc.set) }),
      enumerable: desc.enumerable,
      configurable: desc.configurable,
    };
  }

  private value(value: StoredValue): unknown {
    if ('ref' in value) return this.resolve(value.ref);
    return this.window.JSON.parse(JSON.stringify(value.json));
  }
}

export class JsdomEngine implements Engine {
  readonly manifest: EngineManifest;
  private activeCount = 0;

  constructor() {
    const require = createRequire(import.meta.url);
    const jsdomVersion = (require('jsdom/package.json') as { version: string }).version;
    const source = {
      engine: 'jsdom',
      abi: 'mimic-jsdom-v2.6',
      jsdom: jsdomVersion,
      requestedJsdom: packageJSON.dependencies.jsdom,
      node: process.versions.node.split('.')[0],
      v8: process.versions.v8,
      options: { runScripts: 'outside-only', pretendToBeVisual: true, cookieJar: true },
    };
    this.manifest = deepFreeze({
      id: 'jsdom',
      hash: createHash('sha256').update(JSON.stringify(source)).digest('hex'),
      blocked: [],
    });
  }

  get active(): number {
    return this.activeCount;
  }

  open(plan: Plan<Op, PlanBind>, drivers: Drivers = {}): Runtime {
    const checked = parsePlan(plan);
    this.checkPlan(checked);
    const jar = new CookieJar();
    try {
      for (const cookie of checked.boot.cookies) jar.setCookieSync(cookie, checked.boot.url);
    } catch (cause) {
      throw new MimicError({ phase: 'install', code: 'BAD_PLAN', message: 'Plan boot cookie 非法', plan: checked.id, cause });
    }
    const dom = new JSDOM(checked.boot.html, {
      url: checked.boot.url,
      cookieJar: jar,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    });
    const context = dom.getInternalVMContext();
    const closeWindow = dom.window.close.bind(dom.window);
    const installer = new Installer(dom.window as unknown as BrowserWindow, checked, drivers);
    try {
      installer.install();
      const runtime = new JsdomRuntime(
        context,
        closeWindow,
        checked,
        () => installer.close(),
        () => installer.report(),
        () => { this.activeCount--; },
      );
      this.activeCount++;
      return runtime;
    } catch (cause) {
      let cleanup: unknown;
      try {
        installer.close();
      } catch (error) {
        cleanup = error;
      } finally {
        try {
          closeWindow();
        } catch (error) {
          cleanup ??= error;
        }
      }
      if (cause instanceof MimicError) throw cause;
      const failure = cleanup === undefined ? cause : new AggregateError([cause, cleanup], 'install and cleanup failed');
      throw new MimicError({ phase: 'install', code: 'INSTALL_FAILED', message: 'jsdom Plan 安装失败', plan: checked.id, cause: failure });
    }
  }

  private checkPlan(plan: Plan<Op, PlanBind>): void {
    if (plan.engine.id !== this.manifest.id || plan.engine.hash !== this.manifest.hash) {
      throw new MimicError({ phase: 'install', code: 'BAD_PLAN', message: 'Plan 与 jsdom Engine manifest 不匹配', plan: plan.id });
    }
  }
}
