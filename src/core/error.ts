import type { ErrorCode, JsonValue, Phase } from './types.js';

interface ErrorInput {
  phase: Phase;
  code: ErrorCode;
  message: string;
  details?: JsonValue;
  plan?: string;
  cause?: unknown;
}

export class MimicError extends Error {
  readonly phase: Phase;
  readonly code: ErrorCode;
  readonly details?: JsonValue;
  readonly plan?: string;

  constructor(input: ErrorInput) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = 'MimicError';
    this.phase = input.phase;
    this.code = input.code;
    if (input.details !== undefined) this.details = input.details;
    if (input.plan !== undefined) this.plan = input.plan;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      phase: this.phase,
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.plan === undefined ? {} : { plan: this.plan }),
    };
  }
}
