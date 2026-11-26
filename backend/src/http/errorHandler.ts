import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, type ErrorCode, NotFoundError, UpstreamError } from '../errors.js';
import type { Logger } from '../ports/Logger.js';

/** The error envelope (blueprint §5.9, D-009). */
export interface ErrorBody {
  readonly error: { readonly code: ErrorCode; readonly message: string };
}

interface ErrorResponse {
  readonly status: number;
  readonly body: ErrorBody;
}

const UPSTREAM_MESSAGE = 'A service we depend on is unavailable. Please try again later.';
const INTERNAL_MESSAGE = 'Something went wrong. Please try again later.';

/** Sends any unmatched route to the error handler as NOT_FOUND. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Route not found.'));
};

/**
 * The single error middleware. Maps errors to the envelope, logs details
 * server-side and never returns stack traces or upstream details.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    const response = toErrorResponse(error);
    const context = { method: req.method, path: req.path, status: response.status, code: response.body.error.code };

    if (response.status >= 500) {
      logger.error('request.failed', { ...context, error });
    } else {
      logger.info('request.rejected', { ...context, message: response.body.error.message });
    }

    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(response.status).json(response.body);
  };
}

function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof UpstreamError) {
    return envelope(error.status, error.code, UPSTREAM_MESSAGE);
  }
  if (error instanceof AppError) {
    return envelope(error.status, error.code, error.message);
  }
  const bodyError = bodyParserErrorMessage(error);
  if (bodyError) {
    return envelope(400, 'VALIDATION_ERROR', bodyError);
  }
  return envelope(500, 'INTERNAL_ERROR', INTERNAL_MESSAGE);
}

/** express.json() errors carry a `type`; map the client-caused ones to 400. */
function bodyParserErrorMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('type' in error)) return undefined;
  switch (error.type) {
    case 'entity.parse.failed':
      return 'Request body is not valid JSON.';
    case 'entity.too.large':
      return 'Request body is too large.';
    case 'encoding.unsupported':
    case 'charset.unsupported':
    case 'request.aborted':
    case 'request.size.invalid':
      return 'Request body could not be read.';
    default:
      return undefined;
  }
}

function envelope(status: number, code: ErrorCode, message: string): ErrorResponse {
  return { status, body: { error: { code, message } } };
}
