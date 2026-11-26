import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/errors.js';
import { FakeProductRepository } from '../support/fakes.js';
import { createTestApp } from '../support/testApp.js';

describe('GET /health (§6.2, D-006)', () => {
  it('returns ok', async () => {
    const { app } = createTestApp();
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('stays ok while the product source is down', async () => {
    const productRepository = new FakeProductRepository([]);
    productRepository.failure = new UpstreamError('down');
    const { app } = createTestApp({ productRepository });

    expect((await request(app).get('/health')).status).toBe(200);
  });
});
