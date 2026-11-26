/**
 * Application errors (blueprint §5.9). Routes and adapters throw these; the single
 * error middleware maps them to the error envelope. Messages of ValidationError and
 * NotFoundError are client-safe; UpstreamError messages are internal and only logged.
 */
export type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'UPSTREAM_ERROR' | 'INTERNAL_ERROR';

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly status: number;
}

export class ValidationError extends AppError {
  override readonly name = 'ValidationError';
  readonly code = 'VALIDATION_ERROR';
  readonly status = 400;
}

export class NotFoundError extends AppError {
  override readonly name = 'NotFoundError';
  readonly code = 'NOT_FOUND';
  readonly status = 404;
}

/** A product source or email provider failed. The message is for logs only. */
export class UpstreamError extends AppError {
  override readonly name = 'UpstreamError';
  readonly code = 'UPSTREAM_ERROR';
  readonly status = 502;
}
