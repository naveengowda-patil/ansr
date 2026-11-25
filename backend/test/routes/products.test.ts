import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/errors.js';
import { buildProduct, FakeProductRepository } from '../support/fakes.js';
import { createTestApp } from '../support/testApp.js';

const catalogue = [
  buildProduct({ id: 1, title: 'Gold Ring', category: 'jewelery', rating: { rate: 4.0, count: 10 } }),
  buildProduct({ id: 2, title: 'Laptop Bag', category: "men's clothing", rating: { rate: 3.0, count: 10 } }),
  buildProduct({ id: 3, title: 'Silver Ring', category: 'jewelery', rating: { rate: 5.0, count: 10 } }),
  buildProduct({ id: 4, title: 'SSD Drive', category: 'electronics', rating: { rate: 2.0, count: 10 } }),
  buildProduct({ id: 5, title: 'Monitor', category: 'electronics', rating: { rate: 4.5, count: 10 } }),
  buildProduct({ id: 6, title: 'Rain Jacket', category: "women's clothing", rating: { rate: 3.5, count: 10 } }),
];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const ids = (items: { id: number }[]) => items.map((item) => item.id);

function failingRepository() {
  const repository = new FakeProductRepository(catalogue);
  repository.failure = new UpstreamError('Product source responded with HTTP 503 from internal-host:8080');
  return repository;
}

describe('GET /products/featured (AC-1, §6.3)', () => {
  it('returns the configured products in order, filled by rating to 5', async () => {
    const { app } = createTestApp({ products: catalogue, settings: { featuredProductIds: [2, 99, 4] } });
    const response = await request(app).get('/products/featured');

    expect(response.status).toBe(200);
    expect(ids(response.body.items)).toEqual([2, 4, 3, 5, 1]);
  });

  it('returns 502 when the product source fails', async () => {
    const { app } = createTestApp({ productRepository: failingRepository() });
    const response = await request(app).get('/products/featured');

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('UPSTREAM_ERROR');
  });
});

describe('GET /products (AC-3, §6.4)', () => {
  it('lists everything, paged, with defaults', async () => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app).get('/products');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 6, page: 1, pageSize: 20 });
    expect(ids(response.body.items)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('searches by q (trimmed, case-insensitive) on title, description or category', async () => {
    const { app } = createTestApp({ products: catalogue });

    expect(ids((await request(app).get('/products').query({ q: '  RING ' })).body.items)).toEqual([1, 3]);
    expect(ids((await request(app).get('/products').query({ q: 'electronics' })).body.items)).toEqual([4, 5]);
  });

  it('returns an empty page when nothing matches', async () => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app).get('/products').query({ q: 'teapot' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('applies filters, sort and paging', async () => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app)
      .get('/products')
      .query({ category: 'jewelery', sort: 'rating_desc', page: 1, pageSize: 1 });

    expect(response.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(ids(response.body.items)).toEqual([3]);
  });

  it.each([
    ['blank q', { q: '   ' }],
    ['q over 100 chars', { q: 'x'.repeat(101) }],
    ['unknown param', { colour: 'red' }],
    ['unknown sort', { sort: 'cheapest' }],
    ['negative price', { minPrice: '-1' }],
    ['non-numeric price', { maxPrice: 'ten' }],
    ['minPrice above maxPrice', { minPrice: '20', maxPrice: '10' }],
    ['rating above 5', { minRating: '6' }],
    ['page 0', { page: '0' }],
    ['pageSize over 50', { pageSize: '51' }],
  ])('rejects %s with 400', async (_label, query) => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app).get('/products').query(query);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a repeated param with 400', async () => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app).get('/products?q=ring&q=bag');

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Query parameter 'q' must be given once, as a plain value.");
  });
});

describe('GET /products/:id (AC-4, §6.5)', () => {
  it('returns the product', async () => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app).get('/products/3');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(catalogue[2]);
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app).get('/products/999');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Product not found.' } });
  });

  it.each(['abc', '0', '-1', '1.5'])('returns 400 for id %s', async (id) => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app).get(`/products/${id}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /products/:id/image (§6.6, D-001)', () => {
  it('returns the bytes with content type, cache and nosniff headers', async () => {
    const repository = new FakeProductRepository(catalogue, new Map([[1, { contentType: 'image/png', data: PNG }]]));
    const { app } = createTestApp({ productRepository: repository, settings: { imageClientMaxAgeSeconds: 600 } });
    const response = await request(app).get('/products/1/image').buffer(true);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('public, max-age=600');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(new Uint8Array(response.body as Buffer)).toEqual(PNG);
  });

  it('returns 404 for an unknown product', async () => {
    const { app } = createTestApp({ products: catalogue });
    expect((await request(app).get('/products/999/image')).status).toBe(404);
  });

  it('returns 400 for an invalid id', async () => {
    const { app } = createTestApp({ products: catalogue });
    expect((await request(app).get('/products/abc/image')).status).toBe(400);
  });

  it('returns 502 without upstream details when the image fetch fails', async () => {
    const { app } = createTestApp({ productRepository: failingRepository() });
    const response = await request(app).get('/products/1/image');

    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain('internal-host');
  });
});
