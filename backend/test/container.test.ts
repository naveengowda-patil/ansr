import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createContainer } from '../src/container.js';
import { textSearchOnly } from '../src/domain/search.js';

/** The composition root wires the running app (blueprint §5.3). Nothing here touches the network. */

const config = loadConfig({
  PRODUCT_API_BASE_URL: 'https://fakestoreapi.com',
  IMAGE_HOST_ALLOWLIST: 'fakestoreapi.com',
  FEATURED_PRODUCT_IDS: '1,5',
  SMTP_HOST: 'mailpit',
  SMTP_PORT: '1025',
  MAIL_FROM: 'catalogue@example.com',
  SALES_INBOX_EMAIL: 'sales@example.com',
  LOG_LEVEL: 'error',
});

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
});
