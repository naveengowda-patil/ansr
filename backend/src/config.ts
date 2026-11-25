import { z } from 'zod';
import type { LogLevel } from './ports/Logger.js';

/**
 * The only module that reads environment variables (blueprint §5.10).
 * Environment-specific values (URLs, hosts, addresses, ids) are required;
 * tuning values (timeouts, TTLs, limits) have safe defaults. Invalid config
 * fails fast at startup with every problem listed.
 */
export interface Config {
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly productApi: {
    readonly baseUrl: string;
    readonly timeoutMs: number;
    readonly cacheTtlSeconds: number;
    readonly staleMaxAgeSeconds: number;
    readonly retryBackoffSeconds: number;
  };
  readonly images: {
    readonly hostAllowlist: readonly string[];
    readonly timeoutMs: number;
    readonly cacheMaxEntries: number;
    readonly maxBytes: number;
    readonly clientMaxAgeSeconds: number;
  };
  readonly featuredProductIds: readonly number[];
  readonly smtp: {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
    readonly user?: string | undefined;
    readonly pass?: string | undefined;
    /** Connection, greeting and socket timeout. */
    readonly timeoutMs: number;
  };
  readonly mail: {
    readonly from: string;
    readonly salesInboxEmail: string;
  };
  readonly jsonBodyLimit: string;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

const positiveInt = (fallback?: number) => {
  const schema = z
    .string()
    .trim()
    .regex(/^\d+$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().int().positive());
  return fallback === undefined ? schema : schema.default(fallback);
};

const commaList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value));

const envSchema = z.object({
  PORT: positiveInt(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  PRODUCT_API_BASE_URL: z.url({ protocol: /^https?$/ }),
  PRODUCT_API_TIMEOUT_MS: positiveInt(5000),
  PRODUCT_CACHE_TTL_SECONDS: positiveInt(300),
  PRODUCT_STALE_MAX_AGE_SECONDS: positiveInt(86_400),
  CACHE_RETRY_BACKOFF_SECONDS: positiveInt(30),

  IMAGE_HOST_ALLOWLIST: commaList.pipe(
    z.array(z.string().regex(/^[a-z0-9.-]+$/i, 'must be hostnames only')).min(1, 'must list at least one host'),
  ),
  IMAGE_TIMEOUT_MS: positiveInt(5000),
  IMAGE_CACHE_MAX_ENTRIES: positiveInt(100),
  IMAGE_MAX_BYTES: positiveInt(5 * 1024 * 1024),
  IMAGE_CLIENT_MAX_AGE_SECONDS: positiveInt(86_400),

  FEATURED_PRODUCT_IDS: commaList.pipe(
    z.array(z.string().regex(/^[1-9]\d*$/, 'must be positive whole numbers').transform(Number)),
  ),

  SMTP_HOST: z.string().trim().min(1),
  SMTP_PORT: positiveInt(),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_TIMEOUT_MS: positiveInt(10_000),

  MAIL_FROM: z.email(),
  SALES_INBOX_EMAIL: z.email(),

  JSON_BODY_LIMIT: z
    .string()
    .trim()
    .regex(/^\d+(b|kb|mb)$/i, 'must look like 10kb')
    .default('10kb'),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(env)'}: ${issue.message}`);
    throw new ConfigError(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    productApi: {
      baseUrl: e.PRODUCT_API_BASE_URL,
      timeoutMs: e.PRODUCT_API_TIMEOUT_MS,
      cacheTtlSeconds: e.PRODUCT_CACHE_TTL_SECONDS,
      staleMaxAgeSeconds: e.PRODUCT_STALE_MAX_AGE_SECONDS,
      retryBackoffSeconds: e.CACHE_RETRY_BACKOFF_SECONDS,
    },
    images: {
      hostAllowlist: e.IMAGE_HOST_ALLOWLIST.map((host) => host.toLowerCase()),
      timeoutMs: e.IMAGE_TIMEOUT_MS,
      cacheMaxEntries: e.IMAGE_CACHE_MAX_ENTRIES,
      maxBytes: e.IMAGE_MAX_BYTES,
      clientMaxAgeSeconds: e.IMAGE_CLIENT_MAX_AGE_SECONDS,
    },
    featuredProductIds: e.FEATURED_PRODUCT_IDS,
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER,
      pass: e.SMTP_PASS,
      timeoutMs: e.SMTP_TIMEOUT_MS,
    },
    mail: { from: e.MAIL_FROM, salesInboxEmail: e.SALES_INBOX_EMAIL },
    jsonBodyLimit: e.JSON_BODY_LIMIT,
  };
}
