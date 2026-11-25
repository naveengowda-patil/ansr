import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
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
