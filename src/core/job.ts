import { Ajv } from 'ajv';
import jobSchema from '../../schemas/v2/job.schema.json' with { type: 'json' };
import type { Job } from './types.js';
import { httpUrl, parseValue } from './validation.js';

const validateJob = new Ajv({ allErrors: true, strict: true }).compile<Job>(jobSchema);

export function parseJob(input: unknown): Job {
  const job = parseValue(input, validateJob, 'BAD_JOB', 'Job');
  if ('scriptUrl' in job && job.scriptUrl !== undefined) httpUrl(job.scriptUrl, 'BAD_JOB', 'scriptUrl');
  return job;
}

export function normalizedJob(input: unknown): Job {
  const job = parseJob(input);
  if (job.kind !== 'diagnose' || job.trace === true) return job;
  return parseJob({ ...job, trace: true });
}
