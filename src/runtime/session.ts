import { MimicError } from '../core/error.js';
import { jsonCopy } from '../core/json.js';
import type { Data, JsonValue } from '../core/types.js';
import type { Drivers, DriverSession } from '../engine/types.js';

/** Owns task-local driver state; never retains resources across Engine.open calls. */
export class ExecutionSession {
  private readonly sessions = new Map<string, DriverSession>();
  private readonly records = new Map<string, JsonValue[]>();
  private closed = false;

  constructor(private readonly drivers: Drivers, private readonly plan: string) {}

  driver(id: string): DriverSession {
    this.assertOpen();
    let session = this.sessions.get(id);
    if (!session) {
      const driver = this.drivers[id];
      if (!driver) throw new MimicError({ phase: 'install', code: 'NO_DRIVER', message: `Runtime 缺少 Driver:${id}` });
      session = driver.createSession ? driver.createSession() : driver;
      if (session === null || typeof session !== 'object' || typeof session.open !== 'function') {
        throw new MimicError({ phase: 'install', code: 'INSTALL_FAILED', message: `Driver session 非法:${id}`, plan: this.plan });
      }
      this.sessions.set(id, session);
    }
    return session;
  }

  record(id: string, value: JsonValue): void {
    this.assertOpen();
    let records = this.records.get(id);
    if (!records) {
      records = [];
      this.records.set(id, records);
    }
    records.push(jsonCopy(value));
  }

  report(realms: readonly Data[]): Data {
    this.assertOpen();
    const grouped = new Map<string, JsonValue[]>();
    for (const realm of realms) {
      for (const [id, value] of Object.entries(realm)) {
        let reports = grouped.get(id);
        if (!reports) {
          reports = [];
          grouped.set(id, reports);
        }
        reports.push(value);
      }
    }
    const output: Data = {};
    for (const [id, reports] of grouped) {
      try {
        const driver = this.driver(id);
        const value = driver.reduceReports
          ? driver.reduceReports(reports, this.records.get(id) ?? [])
          : reports.find((report) => report !== null) ?? null;
        Object.defineProperty(output, id, {
          value: jsonCopy(value), writable: true, enumerable: true, configurable: true,
        });
      } catch (cause) {
        throw new MimicError({
          phase: 'run', code: 'RUN_FAILED', message: `Driver report 失败:${id}`,
          details: { driver: id }, plan: this.plan, cause,
        });
      }
    }
    return output;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    let first: unknown;
    for (const session of [...this.sessions.values()].reverse()) {
      try { session.close?.(); } catch (cause) { first ??= cause; }
    }
    this.sessions.clear();
    this.records.clear();
    if (first) throw first;
  }

  private assertOpen(): void {
    if (this.closed) throw new MimicError({ phase: 'run', code: 'RUN_FAILED', message: 'ExecutionSession 已关闭', plan: this.plan });
  }
}
