import { z } from 'zod';

/** Path/query integer ≥ 1, given as a string. */
export const positiveIntParam = z
  .string()
  .regex(/^[1-9]\d*$/, 'must be a positive whole number')
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

/** Query number ≥ 0, given as a string (e.g. "10" or "10.5"). */
export const nonNegativeNumberParam = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative number')
  .transform(Number);

export const productIdParams = z.strictObject({ id: positiveIntParam });
