import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type ClosableMailTransport, createContainer } from '../src/container.js';
import { imageResponse, productsFixture } from './support/fakeStore.js';

/**
 * Debug log events end to end (blueprint §5.11): the real container, logger, caches,
 * repository, engine and email service, with only fetch, the mail transport and the
 * log destination replaced. Nothing touches the network.
 */

const DEBUG_EVENTS = [
  'config.loaded',
  'cache.hit',
  'cache.miss',
  'cache.stale',
  'upstream.request',
  'image.fetched',
  'search.executed',
  'email.sending',
  'email.sent',
];

const customer = { productId: 3, name: 'Yara Customer', email: 'yara.customer@example.test', message: 'Private note 7731' };
const secrets = { SMTP_USER: 'smtp-user-XYZ', SMTP_PASS: 'smtp-pass-XYZ' };

/** Drives a typical session and returns every JSON line the app wrote. */
async function runSession(logLevel: string): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  const transport: ClosableMailTransport = { sendMail: vi.fn(async () => ({})), close: vi.fn() };
  const config = loadConfig({
    PRODUCT_API_BASE_URL: 'https://fakestoreapi.com',
    IMAGE_HOST_ALLOWLIST: 'fakestoreapi.com',
    FEATURED_PRODUCT_IDS: '1,5',
    SMTP_HOST: 'mailpit',
    SMTP_PORT: '1025',
    MAIL_FROM: 'catalogue@example.com',
    SALES_INBOX_EMAIL: 'sales@example.com',
    // A 1 s TTL lets the session reach a stale copy without fake timers.
    PRODUCT_CACHE_TTL_SECONDS: '1',
    LOG_LEVEL: logLevel,
    ...secrets,
  });
  const container = createContainer(config, {
    fetch: async (url) => (url.pathname === '/products' ? Response.json(productsFixture) : imageResponse('image/png')),
    createMailTransport: () => transport,
    writeLog: (line) => lines.push(line),
  });
  const app = createApp(container.deps);

  await request(app).get('/products/featured').expect(200); // cache.miss + upstream.request
  await request(app).get('/products').query({ q: 'jacket' }).expect(200); // cache.hit + search.executed
  await request(app).get('/products/1/image').expect(200); // image.fetched
  await request(app).post('/enquiries').send(customer).expect(200); // email.sending + email.sent
  await new Promise((resolve) => setTimeout(resolve, 1_050));
  await request(app).get('/categories').expect(200); // cache.stale (background refresh starts)
  await new Promise((resolve) => setTimeout(resolve, 50));

  container.close();
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('debug log events end to end (§5.11)', () => {
  it('at LOG_LEVEL=debug, every debug event appears', async () => {
    const lines = await runSession('debug');
    const events = new Set(lines.map((line) => line.msg));

    for (const event of DEBUG_EVENTS) {
      expect(events, `missing ${event}`).toContain(event);
    }
  });

  it('at LOG_LEVEL=info, none of the debug lines is written', async () => {
    const lines = await runSession('info');

    expect(lines.filter((line) => line.level === 'debug')).toEqual([]);
    expect(lines.filter((line) => DEBUG_EVENTS.includes(String(line.msg)))).toEqual([]);
    expect(lines.map((line) => line.msg)).toContain('enquiry.sent'); // info lines still flow
  });

  it('no line at debug contains customer data or SMTP credentials', async () => {
    const logged = JSON.stringify(await runSession('debug'));

    for (const value of [customer.name, customer.email, customer.message, secrets.SMTP_USER, secrets.SMTP_PASS]) {
      expect(logged).not.toContain(value);
    }
    expect(logged).not.toContain('@');
  });
});
