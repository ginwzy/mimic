import type { ErrorObject, ValidateFunction } from 'ajv';
import { MimicError } from './error.js';
import { deepFreeze, jsonCopy } from './json.js';
import type { ErrorCode, ParseIssue } from './types.js';

function issues(errors: ErrorObject[] | null | undefined): ParseIssue[] {
  return (errors || []).map(error => ({
    path: error.instancePath || '/', rule: error.keyword, message: error.message || 'invalid value',
  }));
}

export function parseValue<T>(input: unknown, validate: ValidateFunction<T>, code: ErrorCode, name: string): T {
  let value: unknown;
  try {
    value = jsonCopy(input);
  } catch (cause) {
    throw new MimicError({ phase: 'parse', code, message: `${name} 不是纯 JSON`, cause });
  }
  if (!validate(value)) {
    throw new MimicError({ phase: 'parse', code, message: `${name} 不符合 v2 Schema`, details: issues(validate.errors) });
  }
  return deepFreeze(value as T);
}

export function httpUrl(value: string, code: ErrorCode, name: string): void {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw new TypeError('unsupported URL');
  } catch (cause) {
    throw new MimicError({ phase: 'parse', code, message: `${name} 必须是完整的 HTTP(S) URL`, cause });
  }
}
