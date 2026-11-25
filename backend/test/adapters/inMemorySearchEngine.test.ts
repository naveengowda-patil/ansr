import { describe, expect, it } from 'vitest';
import { InMemorySearchEngine } from '../../src/adapters/search/InMemorySearchEngine.js';
import { FILTER_NAMES, type SearchQuery, SORT_OPTIONS } from '../../src/domain/search.js';
import { buildProduct } from '../support/fakes.js';

const catalogue = [
  buildProduct({ id: 1, title: 'Gold Ring', category: 'jewelery', price: 100, rating: { rate: 4, count: 10 } }),
  buildProduct({ id: 2, title: 'Laptop Bag', category: "men's clothing", price: 50, rating: { rate: 3, count: 10 } }),
  buildProduct({ id: 3, title: 'Silver Ring', category: 'jewelery', price: 20, rating: { rate: 5, count: 10 } }),
  buildProduct({ id: 4, title: 'SSD Drive', category: 'electronics', price: 80, rating: { rate: 2, count: 10 } }),
];
const query = (overrides: Partial<SearchQuery> = {}): SearchQuery => ({
  sort: 'relevance',
  page: 1,
  pageSize: 20,
  ...overrides,
});

async function indexedEngine() {
  const engine = new InMemorySearchEngine();
  await engine.index(catalogue);
  return engine;
}

describe('InMemorySearchEngine (§5.7)', () => {
  it('supports every filter and sort by default', () => {
    const engine = new InMemorySearchEngine();
    expect([...engine.capabilities.filters]).toEqual([...FILTER_NAMES]);
    expect([...engine.capabilities.sorts]).toEqual([...SORT_OPTIONS]);
    expect(engine.name).toBe('in-memory');
  });

  it('accepts injected capabilities and name', () => {
    const capabilities = { filters: new Set(['q'] as const), sorts: new Set(['relevance'] as const) };
    const engine = new InMemorySearchEngine({ name: 'limited', capabilities });
    expect(engine.capabilities).toBe(capabilities);
    expect(engine.name).toBe('limited');
  });

  it('returns everything in upstream order for relevance with no filters', async () => {
    expect(await (await indexedEngine()).search(query())).toEqual({ ids: [1, 2, 3, 4], total: 4 });
  });

  it('filters by q across title, description and category', async () => {
    const engine = await indexedEngine();
    expect((await engine.search(query({ q: 'ring' }))).ids).toEqual([1, 3]);
    expect((await engine.search(query({ q: 'ELECTRONICS' }))).ids).toEqual([4]);
  });

  it('filters by category, price and rating, combined', async () => {
    const engine = await indexedEngine();
    expect((await engine.search(query({ category: 'jewelery' }))).ids).toEqual([1, 3]);
    expect((await engine.search(query({ minPrice: 50, maxPrice: 80 }))).ids).toEqual([2, 4]);
    expect((await engine.search(query({ minRating: 4 }))).ids).toEqual([1, 3]);
    expect((await engine.search(query({ category: 'jewelery', maxPrice: 50 }))).ids).toEqual([3]);
  });

  it('returns an empty result for an unknown category', async () => {
    expect(await (await indexedEngine()).search(query({ category: 'garden' }))).toEqual({ ids: [], total: 0 });
  });

  it('applies each sort', async () => {
    const engine = await indexedEngine();
    expect((await engine.search(query({ sort: 'rating_desc' }))).ids).toEqual([3, 1, 2, 4]);
    expect((await engine.search(query({ sort: 'price_asc' }))).ids).toEqual([3, 2, 4, 1]);
    expect((await engine.search(query({ sort: 'price_desc' }))).ids).toEqual([1, 4, 2, 3]);
    expect((await engine.search(query({ sort: 'title_asc' }))).ids).toEqual([1, 2, 3, 4]);
  });

  it('pages the results and reports the total across pages', async () => {
    const engine = await indexedEngine();
    expect(await engine.search(query({ page: 2, pageSize: 3 }))).toEqual({ ids: [4], total: 4 });
  });

  it('searches the latest snapshot after re-indexing', async () => {
    const engine = await indexedEngine();
    await engine.index(catalogue.slice(0, 2));
    expect(await engine.search(query())).toEqual({ ids: [1, 2], total: 2 });
  });
});
