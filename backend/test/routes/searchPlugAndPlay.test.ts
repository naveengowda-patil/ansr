import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { InMemorySearchEngine } from '../../src/adapters/search/InMemorySearchEngine.js';
import type { FilterName, SortOption } from '../../src/domain/search.js';
import { buildProduct, RecordingSearchEngine } from '../support/fakes.js';
import { createTestApp } from '../support/testApp.js';

/** Search is a swappable engine behind a capability contract (§5.7, D-008). */

const catalogue = [1, 2, 3, 4].map((id) => buildProduct({ id }));

function limitedEngine() {
  return new InMemorySearchEngine({
    name: 'limited-in-memory',
    capabilities: {
      filters: new Set<FilterName>(['q', 'category']),
      sorts: new Set<SortOption>(['relevance']),
    },
  });
}

describe('unsupported search params, real InMemorySearchEngine with limited capabilities', () => {
  it('rejects an unsupported filter with 400 naming it, and logs a warning', async () => {
    const { app, logger } = createTestApp({ products: catalogue, searchEngine: limitedEngine() });
    const response = await request(app).get('/products').query({ q: 'ring', minPrice: '10' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: "Filter 'minPrice' is not supported yet." },
    });
    expect(logger.withMessage('search.unsupported')).toEqual([
      {
        level: 'warn',
        message: 'search.unsupported',
        context: { param: 'minPrice', value: '10', engine: 'limited-in-memory' },
      },
    ]);
  });

  it('rejects an unsupported sort with 400 naming it, and logs a warning', async () => {
    const { app, logger } = createTestApp({ products: catalogue, searchEngine: limitedEngine() });
    const response = await request(app).get('/products').query({ sort: 'price_asc' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Sort 'price_asc' is not supported yet.");
    expect(logger.withMessage('search.unsupported')).toEqual([
      {
        level: 'warn',
        message: 'search.unsupported',
        context: { param: 'sort', value: 'price_asc', engine: 'limited-in-memory' },
      },
    ]);
  });

  it('still serves supported params', async () => {
    const { app, logger } = createTestApp({ products: catalogue, searchEngine: limitedEngine() });
    const response = await request(app).get('/products').query({ q: 'product 2' });

    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { id: number }) => item.id)).toEqual([2]);
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
