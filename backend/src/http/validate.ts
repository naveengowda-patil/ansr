import type { z } from 'zod';
import { ValidationError } from '../errors.js';

/** Parses `input` with `schema`, or throws a ValidationError listing every problem. */
export function parseWith<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(formatIssues(result.error.issues));
  }
  return result.data;
}

/** Query strings: rejects repeated params (they arrive as arrays) before schema validation. */
export function parseQuery<S extends z.ZodType>(schema: S, query: unknown): z.output<S> {
  if (typeof query === 'object' && query !== null) {
    for (const [key, value] of Object.entries(query)) {
      if (typeof value !== 'string') {
        throw new ValidationError(`Query parameter '${key}' must be given once, as a plain value.`);
      }
    }
  }
  return parseWith(schema, query);
}

/** JSON bodies: must be a JSON object. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }
  return parseWith(schema, body);
}

function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
