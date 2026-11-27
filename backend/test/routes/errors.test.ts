import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeProductRepository } from '../support/fakes.js';
import { createTestApp } from '../support/testApp.js';

/** The single error middleware and envelope (§5.9, D-009). */

describe('error handling', () => {
  it('returns 404 NOT_FOUND for an unknown route', async () => {
    const { app } = createTestApp();
    const response = await request(app).get('/nope');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });

  it('returns 400 for malformed JSON', async () => {
    const { app } = createTestApp();
    const response = await request(app).post('/enquiries').set('Content-Type', 'application/json').send('{"name":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON.' } });
  });

  it('returns 400 for a body over the size limit', async () => {
    const { app } = createTestApp({ settings: { jsonBodyLimit: '1kb' } });
    const response = await request(app)
      .post('/enquiries')
      .send({ productId: 1, name: 'Jane', email: 'jane@example.test', message: 'x'.repeat(2_000) });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Request body is too large.' } });
  });

  it('returns 500 INTERNAL_ERROR without leaking the stack, and logs the error', async () => {
    const productRepository = new FakeProductRepository([]);
    productRepository.failure = new TypeError('Cannot read properties of undefined (secret internals)');
    const { app, logger } = createTestApp({ productRepository });
    const response = await request(app).get('/products/featured');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again later.' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/secret internals|at .*\.ts/);
    expect(logger.withMessage('request.failed')[0]?.context).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });

  it('does not advertise the framework', async () => {
    const { app } = createTestApp();
    expect((await request(app).get('/health')).headers['x-powered-by']).toBeUndefined();
  });
});
