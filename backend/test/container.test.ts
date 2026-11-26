import { describe, expect, it, vi } from 'vitest';
import { loadConfig, safeConfigSummary } from '../src/config.js';
import {
  type ClosableMailTransport,
  createContainer,
  type SmtpTransportOptions,
  smtpTransportOptions,
} from '../src/container.js';
import { textSearchOnly } from '../src/domain/search.js';

/** The composition root wires the running app (blueprint §5.3). Nothing here touches the network. */

const env = {
  PRODUCT_API_BASE_URL: 'https://fakestoreapi.com',
  IMAGE_HOST_ALLOWLIST: 'fakestoreapi.com',
  FEATURED_PRODUCT_IDS: '1,5',
  SMTP_HOST: 'mailpit',
  SMTP_PORT: '1025',
  MAIL_FROM: 'catalogue@example.com',
  SALES_INBOX_EMAIL: 'sales@example.com',
  LOG_LEVEL: 'error',
};
const config = loadConfig(env);

describe('createContainer', () => {
  it('gives the running app a text-search-only engine (D-008)', () => {
    const container = createContainer(config);
    try {
      expect(container.deps.searchEngine.capabilities).toEqual(textSearchOnly());
    } finally {
      container.close();
    }
  });

  it('passes settings from config through to the app', () => {
    const container = createContainer(config);
    try {
      expect(container.deps.settings).toMatchObject({
        featuredProductIds: [1, 5],
        salesInboxEmail: 'sales@example.com',
        mailFrom: 'catalogue@example.com',
      });
    } finally {
      container.close();
    }
  });

  it('passes SMTP_TIMEOUT_MS to the transport as connection, greeting and socket timeouts (§5.8)', () => {
    const transport: ClosableMailTransport = { sendMail: vi.fn(), close: vi.fn() };
    const createMailTransport = vi.fn((_options: SmtpTransportOptions) => transport);

    const container = createContainer(loadConfig({ ...env, SMTP_TIMEOUT_MS: '7000' }), { createMailTransport });
    container.close();

    expect(createMailTransport).toHaveBeenCalledTimes(1);
    expect(createMailTransport.mock.calls[0]?.[0]).toEqual({
      host: 'mailpit',
      port: 1025,
      secure: false,
      connectionTimeout: 7000,
      greetingTimeout: 7000,
      socketTimeout: 7000,
    });
    expect(transport.close).toHaveBeenCalledTimes(1);
  });
});

describe('smtpTransportOptions', () => {
  it('uses the 10 s default timeout', () => {
    expect(smtpTransportOptions(config.smtp)).toMatchObject({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
  });

  it('adds auth only when both user and pass are set', () => {
    const withAuth = loadConfig({ ...env, SMTP_USER: 'user', SMTP_PASS: 'pass' });
    const userOnly = loadConfig({ ...env, SMTP_USER: 'user' });

    expect(smtpTransportOptions(withAuth.smtp).auth).toEqual({ user: 'user', pass: 'pass' });
    expect(smtpTransportOptions(userOnly.smtp)).not.toHaveProperty('auth');
  });
});

describe('config.loaded (§5.11)', () => {
  const secrets = {
    SMTP_USER: 'smtp-user-AKIA123',
    SMTP_PASS: 'smtp-pass-s3cr3t',
    MAIL_FROM: 'catalogue@example.com',
    SALES_INBOX_EMAIL: 'sales-team@example.com',
  };

  function linesFor(logLevel: string): Record<string, unknown>[] {
    const lines: string[] = [];
    const transport: ClosableMailTransport = { sendMail: vi.fn(), close: vi.fn() };
    const container = createContainer(loadConfig({ ...env, ...secrets, LOG_LEVEL: logLevel }), {
      createMailTransport: () => transport,
      writeLog: (line) => lines.push(line),
    });
    container.close();
    return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it('is logged once at startup at debug, with the safe values', () => {
    const loaded = linesFor('debug').filter((line) => line.msg === 'config.loaded');

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      level: 'debug',
      port: 3000,
      logLevel: 'debug',
      featuredProductIds: [1, 5],
      images: { hostAllowlist: ['fakestoreapi.com'] },
      smtp: { host: 'mailpit', port: 1025, secure: false },
      timeoutsMs: { smtp: 10_000 },
    });
  });

  it('never contains SMTP_USER, SMTP_PASS or any email address', () => {
    const logged = JSON.stringify(linesFor('debug'));

    for (const secret of Object.values(secrets)) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).not.toContain('@');
    expect(JSON.stringify(safeConfigSummary(loadConfig({ ...env, ...secrets })))).not.toMatch(/@|smtp-user|smtp-pass/);
  });

  it('is not written at LOG_LEVEL=info', () => {
    expect(linesFor('info')).toEqual([]);
  });
});
