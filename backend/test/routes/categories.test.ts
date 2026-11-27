import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/errors.js';
import { buildProduct, FakeProductRepository } from '../support/fakes.js';
import { createTestApp } from '../support/testApp.js';

const mens = "men's clothing";
const catalogue = [
  buildProduct({ id: 1, category: mens, rating: { rate: 2.0, count: 10 } }),
  buildProduct({ id: 2, category: 'jewelery', rating: { rate: 4.0, count: 10 } }),
  buildProduct({ id: 3, category: mens, rating: { rate: 4.5, count: 10 } }),
  buildProduct({ id: 4, category: mens, rating: { rate: 1.0, count: 10 } }),
  buildProduct({ id: 5, category: mens, rating: { rate: 3.9, count: 10 } }),
  buildProduct({ id: 6, category: mens, rating: { rate: 4.9, count: 10 } }),
];
const ids = (items: { id: number }[]) => items.map((item) => item.id);

describe('GET /categories (§6.7, D-005)', () => {
  it('lists category names in first-seen order', async () => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app).get('/categories');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [mens, 'jewelery'] });
  });

  it('returns 502 when the product source fails', async () => {
    const productRepository = new FakeProductRepository(catalogue);
    productRepository.failure = new UpstreamError('down');
    const { app } = createTestApp({ productRepository });

    expect((await request(app).get('/categories')).status).toBe(502);
  });
});

describe('GET /categories/:category (AC-2, §6.8, D-004)', () => {
  it('returns the 3 top rated first, then the rest in upstream order', async () => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app).get(`/categories/${encodeURIComponent(mens)}`);

    expect(response.status).toBe(200);
    expect(response.body.category).toBe(mens);
    expect(ids(response.body.topRated)).toEqual([6, 3, 5]);
    expect(ids(response.body.rest)).toEqual([1, 4]);
  });

  it('returns an empty rest for a small category', async () => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app).get('/categories/jewelery');

    expect(ids(response.body.topRated)).toEqual([2]);
    expect(response.body.rest).toEqual([]);
  });

  it('returns 404 for an unknown category', async () => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app).get('/categories/garden');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Category not found.' } });
  });

  it.each(['JEWELERY', 'Jewelery', 'jewelery'])(
    'matches %s case-insensitively and returns the name as the data spells it',
    async (requested) => {
      const { app } = createTestApp({ products: catalogue });
      const response = await request(app).get(`/categories/${requested}`);

      expect(response.status).toBe(200);
      expect(response.body.category).toBe('jewelery');
      expect(ids(response.body.topRated)).toEqual([2]);
    },
  );

  it('matches a multi-word category case-insensitively', async () => {
    const { app } = createTestApp({ products: catalogue });
    const response = await request(app).get(`/categories/${encodeURIComponent("MEN'S CLOTHING")}`);

    expect(response.status).toBe(200);
    expect(response.body.category).toBe(mens);
    expect(ids(response.body.topRated)).toEqual([6, 3, 5]);
  });

  it('does not match a partial category name', async () => {
    const { app } = createTestApp({ products: catalogue });
    expect((await request(app).get('/categories/jewel')).status).toBe(404);
  });
});
