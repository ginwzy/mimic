import { Ajv, type ErrorObject } from 'ajv';
import dataSchema from '../../../schemas/v2/data.schema.json' with { type: 'json' };
import resultSchema from '../../../schemas/v2/result.schema.json' with { type: 'json' };
import { MimicError } from './error.js';
import { deepFreeze, jsonCopy } from './json.js';
import type { Data, JsonValue, ParseIssue, Result, SupportMap } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(dataSchema);
const validate = ajv.compile<Result>(resultSchema);

function issues(errors: ErrorObject[] | null | undefined): ParseIssue[] {
  return (errors || []).map((error) => ({
    path: error.instancePath || '/',
    rule: error.keyword,
    message: error.message || 'invalid value',
  }));
}

export function parseResult(input: unknown): Result {
  let value: JsonValue;
  try {
    value = jsonCopy(input);
  } catch (cause) {
    throw new MimicError({ phase: 'parse', code: 'BAD_RESULT', message: 'Result 不是纯 JSON', cause });
  }
  if (!validate(value)) {
    throw new MimicError({
      phase: 'parse',
      code: 'BAD_RESULT',
      message: 'Result 不符合 v2 Schema',
      details: issues(validate.errors),
    });
  }
  const result = value as unknown as Result;
  if (result.ok === false && result.plan !== undefined && result.error.plan !== undefined && result.plan !== result.error.plan) {
    throw new MimicError({ phase: 'parse', code: 'BAD_RESULT', message: 'Result 与 ErrorInfo 的 Plan 不一致' });
  }
  return deepFreeze(result);
}

interface Meta {
  readonly plan: string;
  readonly support: SupportMap;
  readonly report?: Data;
}

function plain(proto: object | null): boolean {
  if (proto === null) return true;
  if (Object.getPrototypeOf(proto) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(proto, 'constructor');
  if (!constructor || !('value' in constructor) || typeof constructor.value !== 'function') return false;
  const prototype = Object.getOwnPropertyDescriptor(constructor.value, 'prototype');
  return !!prototype && 'value' in prototype && prototype.value === proto;
}

function fields(input: object): Record<string, PropertyDescriptor> {
  const proto = Object.getPrototypeOf(input);
  if (!plain(proto)) throw new TypeError('Result 必须是纯对象');
  if (Object.getOwnPropertySymbols(input).length) throw new TypeError('Result 不能含 Symbol key');
  return Object.getOwnPropertyDescriptors(input);
}

function data(
  descriptors: Record<string, PropertyDescriptor>,
  key: string,
  required: boolean,
): unknown {
  const descriptor = descriptors[key];
  if (descriptor === undefined) {
    if (required) throw new TypeError(`Result 缺少字段:${key}`);
    return undefined;
  }
  if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError(`Result 字段不是 enumerable data:${key}`);
  return descriptor.value;
}

function copy(value: unknown, path: string, parents: Set<object>): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path}:number must be finite`);
    if (Object.is(value, -0)) throw new TypeError(`${path}:negative zero is not JSON round-trip safe`);
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`${path}:unsupported ${typeof value}`);
  if (parents.has(value)) throw new TypeError(`${path}:cyclic value`);

  parents.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${path}:symbol keys are not JSON safe`);
      const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
      const lengthDescriptor = descriptors['length'];
      if (!lengthDescriptor || !('value' in lengthDescriptor) || typeof lengthDescriptor.value !== 'number') {
        throw new TypeError(`${path}:array length must be data`);
      }
      const length = lengthDescriptor.value;
      if (Object.keys(descriptors).length !== length + 1) throw new TypeError(`${path}:array must be dense without extra properties`);
      const output: JsonValue[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw new TypeError(`${path}/${index}:array item must be enumerable data`);
        }
        output.push(copy(descriptor.value, `${path}/${index}`, parents));
      }
      return output;
    }

    if (!plain(Object.getPrototypeOf(value))) throw new TypeError(`${path}:object must be plain`);
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${path}:symbol keys are not JSON safe`);
    const output: Record<string, JsonValue> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError(`${path}/${key}:property must be enumerable data`);
      Object.defineProperty(output, key, {
        value: copy(descriptor.value, `${path}/${key}`, parents),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return output;
  } finally {
    parents.delete(value);
  }
}

function wireCopy(value: unknown): JsonValue {
  return copy(value, '$', new Set<object>());
}

function failure(meta?: Meta): Result {
  const error = {
    name: 'MimicError' as const,
    phase: 'encode' as const,
    code: 'ENCODE_FAILED' as const,
    message: 'Result 无法编码为 JSON',
    ...(meta === undefined ? {} : { plan: meta.plan }),
  };
  return deepFreeze({
    ok: false as const,
    error,
    ...(meta?.report === undefined ? {} : { report: meta.report }),
    ...(meta === undefined ? {} : { plan: meta.plan, support: meta.support }),
  });
}

export function encodeResult(input: Result<unknown>): Result {
  let meta: Meta | undefined;
  try {
    if (input === null || typeof input !== 'object') return failure();
    const descriptors = fields(input);
    const ok = data(descriptors, 'ok', true);
    if (ok === true) {
      const checked = parseResult({
        ok: true,
        plan: data(descriptors, 'plan', true),
        support: data(descriptors, 'support', true),
      });
      if (!checked.ok) return failure();
      meta = { plan: checked.plan, support: checked.support };
      const report = data(descriptors, 'report', false);
      if (report !== undefined) {
        const withReport = parseResult({
          ok: true,
          plan: checked.plan,
          support: checked.support,
          report: wireCopy(report),
        });
        if (!withReport.ok || withReport.report === undefined) return failure(meta);
        meta = { ...meta, report: withReport.report };
      }
      const wire: Record<string, unknown> = {};
      for (const key of Object.keys(descriptors)) {
        const value = data(descriptors, key, true);
        if (key !== 'value' || value !== undefined) wire[key] = value;
      }
      return parseResult(wireCopy(wire));
    }
    return parseResult(wireCopy(input));
  } catch {
    return failure(meta);
  }
}
