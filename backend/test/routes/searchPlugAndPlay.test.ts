import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { InMemorySearchEngine } from '../../src/adapters/search/InMemorySearchEngine.js';
import { allCapabilities } from '../../src/domain/search.js';
import { buildProduct, RecordingSearchEngine } from '../support/fakes.js';
import { createTestApp } from '../support/testApp.js';

/** Search is a swappable engine behind a capability contract (§5.7, D-008). */

const catalogue = [
  buildProduct({ id: 1, title: 'Gold Ring', category: 'jewelery', price: 100 }),
  buildProduct({ id: 2, title: 'Laptop Bag', category: "men's clothing", price: 50 }),
  buildProduct({ id: 3, title: 'Silver Ring', category: 'jewelery', price: 20 }),
  buildProduct({ id: 4, title: 'SSD Drive', category: 'electronics', price: 80 }),
];
const ids = (items: { id: number }[]) => items.map((item) => item.id);

/** The running app's engine: new InMemorySearchEngine() is text search only. */
function runningAppSearch() {
  return createTestApp({ products: catalogue, searchEngine: new InMemorySearchEngine() });
}

describe('the running app does text search only (default InMemorySearchEngine)', () => {
  it.each([
    ['category', 'jewelery', "Filter 'category' is not supported yet."],
    ['minPrice', '10', "Filter 'minPrice' is not supported yet."],
    ['maxPrice', '90', "Filter 'maxPrice' is not supported yet."],
    ['minRating', '4', "Filter 'minRating' is not supported yet."],
    ['sort', 'rating_desc', "Sort 'rating_desc' is not supported yet."],
    ['sort', 'price_asc', "Sort 'price_asc' is not supported yet."],
    ['sort', 'price_desc', "Sort 'price_desc' is not supported yet."],
    ['sort', 'title_asc', "Sort 'title_asc' is not supported yet."],
  ])('rejects %s=%s with 400 naming it, and logs a warning', async (param, value, message) => {
    const { app, logger } = runningAppSearch();
    const response = await request(app).get('/products').query({ q: 'ring', [param]: value });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: 'VALIDATION_ERROR', message } });
    expect(logger.withMessage('search.unsupported')).toEqual([
      { level: 'warn', message: 'search.unsupported', context: { param, value, engine: 'in-memory' } },
    ]);
  });

  it('names every unsupported param in one response', async () => {
    const { app, logger } = runningAppSearch();
    const response = await request(app).get('/products').query({ category: 'jewelery', sort: 'price_asc' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe(
      "Filter 'category' is not supported yet. Sort 'price_asc' is not supported yet.",
    );
    expect(logger.withMessage('search.unsupported')).toHaveLength(2);
  });

  it('serves q, sort=relevance and paging', async () => {
    const { app, logger } = runningAppSearch();
    const response = await request(app)
      .get('/products')
      .query({ q: 'ring', sort: 'relevance', page: '2', pageSize: '1' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(ids(response.body.items)).toEqual([3]);
    expect(logger.withMessage('search.unsupported')).toEqual([]);
  });

  it('still validates the shape of params it does not support', async () => {
    const { app, logger } = runningAppSearch();
    const response = await request(app).get('/products').query({ minPrice: 'ten' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('minPrice');
    expect(logger.withMessage('search.unsupported')).toEqual([]);
  });
});

describe('additional filters and sorts (built and unit-tested, not enabled in the running app)', () => {
  it('are served by the same real engine when it is created with allCapabilities()', async () => {
    const searchEngine = new InMemorySearchEngine({ capabilities: allCapabilities() });
    const { app, logger } = createTestApp({ products: catalogue, searchEngine });
    const response = await request(app).get('/products').query({ category: 'JEWELERY', sort: 'price_asc' });

    expect(response.status).toBe(200);
    expect(ids(response.body.items)).toEqual([3, 1]);
    expect(logger.withMessage('search.unsupported')).toEqual([]);
  });
});

describe('plug and play: a fake engine that supports everything', () => {
  it('receives the exact parsed query and drives the response order and total', async () => {
    const engine = new RecordingSearchEngine({ ids: [3, 1], total: 42 });
    const { app } = createTestApp({ products: catalogue, searchEngine: engine });

    const response = await request(app).get('/products').query({
      q: ' ring ',
      category: 'jewelery',
      minPrice: '1.5',
      maxPrice: '20',
      minRating: '3',
      sort: 'price_desc',
      page: '2',
      pageSize: '10',
    });

    expect(response.status).toBe(200);
    expect(engine.queries).toEqual([
      {
        q: 'ring',
        category: 'jewelery',
        minPrice: 1.5,
        maxPrice: 20,
        minRating: 3,
        sort: 'price_desc',
        page: 2,
        pageSize: 10,
      },
    ]);
    expect(engine.indexed).toBe(catalogue);
    expect(response.body).toEqual({ items: [catalogue[2], catalogue[0]], total: 42, page: 2, pageSize: 10 });
  });
});
