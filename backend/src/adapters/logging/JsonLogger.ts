import type { LogContext, Logger, LogLevel } from '../../ports/Logger.js';

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Writes one JSON object per line (stdout → CloudWatch on AWS). */
export class JsonLogger implements Logger {
  constructor(
    private readonly minLevel: LogLevel,
    private readonly write: (line: string) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  private log(level: LogLevel, message: string, context: LogContext = {}): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      fields[key] = value instanceof Error ? serializeError(value) : value;
    }
    this.write(JSON.stringify({ time: this.now().toISOString(), level, msg: message, ...fields }));
  }
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string | undefined;
  cause?: unknown;
}

function serializeError(error: Error): SerializedError {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause,
  };
}
