import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import collectSchema from '../../schemas/v2/collect.schema.json' with { type: 'json' };
import dataSchema from '../../schemas/v2/data.schema.json' with { type: 'json' };
import catalogSchema from '../../schemas/v2/catalog.schema.json' with { type: 'json' };
import irSchema from '../../schemas/v2/ir.schema.json' with { type: 'json' };
import jobSchema from '../../schemas/v2/job.schema.json' with { type: 'json' };
import pageSchema from '../../schemas/v2/page.schema.json' with { type: 'json' };
import profileSchema from '../../schemas/v2/profile.schema.json' with { type: 'json' };
import shapeSchema from '../../schemas/v2/shape.schema.json' with { type: 'json' };
import { MimicError } from './error.js';
import { deepFreeze, jsonCopy } from './json.js';
import { validHash } from './seal.js';
import type { CollectBundle } from '../collect/types.js';
import type { CatalogDoc, ErrorCode, Job, Page, ParseIssue, Profile, Shape, Target } from './types.js';
import {
  isTrustedPage,
  isTrustedProfile,
  isTrustedShape,
  trustPage,
  trustProfile,
  trustShape,
} from './trusted.js';

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(dataSchema);
ajv.addSchema(irSchema);
ajv.addSchema(shapeSchema);
const validateJob = ajv.compile<Job>(jobSchema);
const validateCollect = ajv.compile<CollectBundle>(collectSchema);
const validateShape = ajv.getSchema<Shape>(shapeSchema.$id) as ValidateFunction<Shape>;
const validateProfile = ajv.compile<Profile>(profileSchema);
const validatePage = ajv.compile<Page>(pageSchema);
const validateCatalog = ajv.compile<CatalogDoc>(catalogSchema);

function issues(errors: ErrorObject[] | null | undefined): ParseIssue[] {
  return (errors || []).map((error) => ({
    path: error.instancePath || '/',
    rule: error.keyword,
    message: error.message || 'invalid value',
  }));
}

function parse<T>(input: unknown, validate: ValidateFunction<T>, code: ErrorCode, name: string): T {
  let value: unknown;
  try {
    value = jsonCopy(input);
  } catch (cause) {
    throw new MimicError({ phase: 'parse', code, message: `${name} 不是纯 JSON`, cause });
  }
  if (!validate(value)) {
    throw new MimicError({
      phase: 'parse',
      code,
      message: `${name} 不符合 v2 Schema`,
      details: issues(validate.errors),
    });
  }
  return deepFreeze(value as T);
}

function httpUrl(value: string, code: ErrorCode, name: string): void {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw new TypeError('unsupported URL');
  } catch (cause) {
    throw new MimicError({ phase: 'parse', code, message: `${name} 必须是完整的 HTTP(S) URL`, cause });
  }
}

function targetId(target: Target): string {
  return `chromium/${target.host}/${target.platform}/${target.form}/${target.version}`;
}

function coherent(shape: Shape, code: ErrorCode): void {
  const id = targetId(shape.target);
  if (shape.id !== id) {
    throw new MimicError({ phase: 'parse', code, message: `Shape id 与字段不一致:${shape.id}` });
  }
}

export const parseJob = (input: unknown): Job => {
  const job = parse(input, validateJob, 'BAD_JOB', 'Job');
  if ('scriptUrl' in job && job.scriptUrl !== undefined) httpUrl(job.scriptUrl, 'BAD_JOB', 'scriptUrl');
  return job;
};

export const parseCollect = (input: unknown): CollectBundle => {
  const collect = parse(input, validateCollect, 'BAD_COLLECT', 'Collect');
  if (!validHash(collect)) throw new MimicError({ phase: 'parse', code: 'BAD_COLLECT', message: 'Collect content hash 不匹配' });
  return collect;
};

export const parseShape = (input: unknown): Shape => {
  if (isTrustedShape(input)) return input;
  const shape = parse(input, validateShape, 'BAD_SHAPE', 'Shape');
  coherent(shape, 'BAD_SHAPE');
  if (!validHash(shape)) throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: 'Shape content hash 不匹配' });
  return trustShape(shape);
};

export const parseProfile = (input: unknown): Profile => {
  if (isTrustedProfile(input)) return input;
  const profile = parse(input, validateProfile, 'BAD_PROFILE', 'Profile');
  if (profile.shape.id !== targetId(profile.target)) {
    throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: `Profile Shape 引用与设备 target 不一致:${profile.shape.id}` });
  }
  if (!validHash(profile)) throw new MimicError({ phase: 'parse', code: 'BAD_PROFILE', message: 'Profile content hash 不匹配' });
  return trustProfile(profile);
};

export const parsePage = (input: unknown): Page => {
  if (isTrustedPage(input)) return input;
  const page = parse(input, validatePage, 'BAD_PAGE', 'Page');
  if (page.url !== undefined) httpUrl(page.url, 'BAD_PAGE', 'Page.url');
  if (!validHash(page)) throw new MimicError({ phase: 'parse', code: 'BAD_PAGE', message: 'Page content hash 不匹配' });
  return trustPage(page);
};

export const parseCatalog = (input: unknown): CatalogDoc => {
  const catalog = parse(input, validateCatalog, 'BAD_SHAPE', 'Catalog');
  if (!validHash(catalog)) throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: 'Catalog content hash 不匹配' });
  const ids = catalog.shapes.map((shape) => shape.id);
  if (new Set(ids).size !== ids.length) throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: 'Catalog Shape id 重复' });
  for (const shape of catalog.shapes) {
    coherent(shape, 'BAD_SHAPE');
    if (!validHash(shape)) throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: `Shape content hash 不匹配:${shape.id}` });
  }
  const sorted = [...ids].sort();
  if (ids.some((id, index) => id !== sorted[index])) throw new MimicError({ phase: 'parse', code: 'BAD_SHAPE', message: 'Catalog shapes 必须按 id 排序' });
  return catalog;
};
