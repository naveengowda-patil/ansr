import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

/** The required, environment-specific variables (§5.10). */
const required = {
  PRODUCT_API_BASE_URL: 'https://fakestoreapi.com',
  IMAGE_HOST_ALLOWLIST: 'fakestoreapi.com',
  FEATURED_PRODUCT_IDS: '1,5,9',
  SMTP_HOST: 'mailpit',
  SMTP_PORT: '1025',
  MAIL_FROM: 'catalogue@example.com',
  SALES_INBOX_EMAIL: 'sales@example.com',
};

describe('loadConfig (§5.10)', () => {
  it('parses required values and applies defaults for tuning values', () => {
    const config = loadConfig(required);

    expect(config).toEqual({
      port: 3000,
      logLevel: 'info',
      productApi: {
        baseUrl: 'https://fakestoreapi.com',
        timeoutMs: 5000,
        cacheTtlSeconds: 300,
        staleMaxAgeSeconds: 86_400,
        retryBackoffSeconds: 30,
      },
      images: {
        hostAllowlist: ['fakestoreapi.com'],
        timeoutMs: 5000,
        cacheMaxEntries: 100,
        maxBytes: 5_242_880,
        clientMaxAgeSeconds: 86_400,
      },
      featuredProductIds: [1, 5, 9],
      smtp: { host: 'mailpit', port: 1025, secure: false, user: undefined, pass: undefined, timeoutMs: 10_000 },
      mail: { from: 'catalogue@example.com', salesInboxEmail: 'sales@example.com' },
      jsonBodyLimit: '10kb',
    });
  });

  it('reads overrides', () => {
    const config = loadConfig({
      ...required,
      PORT: '8080',
      PRODUCT_STALE_MAX_AGE_SECONDS: '3600',
      CACHE_RETRY_BACKOFF_SECONDS: '5',
      IMAGE_HOST_ALLOWLIST: 'FakeStoreAPI.com, cdn.example.com',
      SMTP_SECURE: 'true',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      SMTP_TIMEOUT_MS: '2500',
    });

    expect(config.port).toBe(8080);
    expect(config.productApi.staleMaxAgeSeconds).toBe(3600);
    expect(config.productApi.retryBackoffSeconds).toBe(5);
    expect(config.images.hostAllowlist).toEqual(['fakestoreapi.com', 'cdn.example.com']);
    expect(config.smtp).toMatchObject({ secure: true, user: 'user', pass: 'pass', timeoutMs: 2500 });
  });

  it('accepts an empty featured list and tolerates spaces', () => {
    expect(loadConfig({ ...required, FEATURED_PRODUCT_IDS: '' }).featuredProductIds).toEqual([]);
    expect(loadConfig({ ...required, FEATURED_PRODUCT_IDS: ' 3 , 1 ' }).featuredProductIds).toEqual([3, 1]);
  });

  it.each([
    ['missing base URL', { PRODUCT_API_BASE_URL: undefined }, 'PRODUCT_API_BASE_URL'],
    ['non-http base URL', { PRODUCT_API_BASE_URL: 'ftp://example.com' }, 'PRODUCT_API_BASE_URL'],
    ['invalid featured ids', { FEATURED_PRODUCT_IDS: '1,two' }, 'FEATURED_PRODUCT_IDS'],
    ['zero featured id', { FEATURED_PRODUCT_IDS: '0' }, 'FEATURED_PRODUCT_IDS'],
    ['empty allowlist', { IMAGE_HOST_ALLOWLIST: ' , ' }, 'IMAGE_HOST_ALLOWLIST'],
    ['URL in allowlist', { IMAGE_HOST_ALLOWLIST: 'https://fakestoreapi.com' }, 'IMAGE_HOST_ALLOWLIST'],
    ['invalid sales email', { SALES_INBOX_EMAIL: 'sales' }, 'SALES_INBOX_EMAIL'],
    ['non-numeric timeout', { PRODUCT_API_TIMEOUT_MS: 'soon' }, 'PRODUCT_API_TIMEOUT_MS'],
    ['zero TTL', { PRODUCT_CACHE_TTL_SECONDS: '0' }, 'PRODUCT_CACHE_TTL_SECONDS'],
    ['non-numeric back-off', { CACHE_RETRY_BACKOFF_SECONDS: 'later' }, 'CACHE_RETRY_BACKOFF_SECONDS'],
    ['invalid boolean', { SMTP_SECURE: 'yes' }, 'SMTP_SECURE'],
    ['zero SMTP timeout', { SMTP_TIMEOUT_MS: '0' }, 'SMTP_TIMEOUT_MS'],
    ['invalid log level', { LOG_LEVEL: 'loud' }, 'LOG_LEVEL'],
  ])('fails fast on %s, naming the variable', (_label, overrides, variable) => {
    expect(() => loadConfig({ ...required, ...overrides })).toThrow(ConfigError);
    expect(() => loadConfig({ ...required, ...overrides })).toThrow(variable);
  });
});
