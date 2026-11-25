import { describe, expect, it } from 'vitest';
import {
  allCapabilities,
  compareForSort,
  describeUnsupported,
  findUnsupported,
  matchesFilters,
  matchesText,
  paginate,
  type SearchQuery,
  type SortOption,
} from '../../src/domain/search.js';
import { buildProduct } from '../support/fakes.js';

const baseQuery: SearchQuery = { sort: 'relevance', page: 1, pageSize: 20 };

describe('matchesText (AC-3, §5.5, D-007)', () => {
  const product = buildProduct({
    id: 1,
    title: 'Mens Cotton Jacket',
    description: 'Great outerwear for spring',
    category: "men's clothing",
  });

  it('matches the title, case-insensitively', () => {
    expect(matchesText(product, 'cotton JACKET')).toBe(true);
  });

  it('matches the description', () => {
    expect(matchesText(product, 'outerwear')).toBe(true);
  });

  it('matches the category text', () => {
    expect(matchesText(product, "MEN'S CLOTH")).toBe(true);
  });

  it('matches the whole phrase, not separate words', () => {
    expect(matchesText(product, 'jacket cotton')).toBe(false);
  });

  it('does not match unrelated text', () => {
    expect(matchesText(product, 'laptop')).toBe(false);
  });
});

describe('matchesFilters (§5.5)', () => {
  const product = buildProduct({ id: 1, category: 'jewelery', price: 50, rating: { rate: 4, count: 1 } });

  it('passes when no filters are present', () => {
    expect(matchesFilters(product, baseQuery)).toBe(true);
  });

  it('matches category exactly', () => {
    expect(matchesFilters(product, { ...baseQuery, category: 'jewelery' })).toBe(true);
    expect(matchesFilters(product, { ...baseQuery, category: 'Jewelery' })).toBe(false);
  });

  it('treats price bounds as inclusive', () => {
    expect(matchesFilters(product, { ...baseQuery, minPrice: 50, maxPrice: 50 })).toBe(true);
    expect(matchesFilters(product, { ...baseQuery, minPrice: 50.01 })).toBe(false);
    expect(matchesFilters(product, { ...baseQuery, maxPrice: 49.99 })).toBe(false);
  });

  it('applies minRating to rating.rate', () => {
    expect(matchesFilters(product, { ...baseQuery, minRating: 4 })).toBe(true);
    expect(matchesFilters(product, { ...baseQuery, minRating: 4.1 })).toBe(false);
  });

  it('requires every filter to hold (AND)', () => {
    expect(matchesFilters(product, { ...baseQuery, category: 'jewelery', minRating: 5 })).toBe(false);
  });
});

describe('compareForSort (§5.5)', () => {
  const products = [
    buildProduct({ id: 1, title: 'banana', price: 20, rating: { rate: 3, count: 1 } }),
    buildProduct({ id: 2, title: 'Apple', price: 10, rating: { rate: 5, count: 1 } }),
    buildProduct({ id: 3, title: 'cherry', price: 10, rating: { rate: 4, count: 1 } }),
  ];
  const sorted = (sort: SortOption) => [...products].sort(compareForSort(sort)).map((p) => p.id);

  it('relevance keeps the input order', () => expect(sorted('relevance')).toEqual([1, 2, 3]));
  it('rating_desc ranks by rating', () => expect(sorted('rating_desc')).toEqual([2, 3, 1]));
  it('price_asc breaks ties by id', () => expect(sorted('price_asc')).toEqual([2, 3, 1]));
  it('price_desc breaks ties by id', () => expect(sorted('price_desc')).toEqual([1, 2, 3]));
  it('title_asc ignores case', () => expect(sorted('title_asc')).toEqual([2, 1, 3]));
});

describe('findUnsupported (§5.7, D-008)', () => {
  it('returns nothing when the engine supports everything', () => {
    const query: SearchQuery = { ...baseQuery, q: 'x', minPrice: 1, sort: 'price_asc' };
    expect(findUnsupported(query, allCapabilities())).toEqual([]);
  });

  it('lists present filters and the sort that are not supported', () => {
    const capabilities = { filters: new Set(['q'] as const), sorts: new Set(['relevance'] as const) };
    const query: SearchQuery = { ...baseQuery, q: 'x', minPrice: 5, sort: 'price_desc' };

    expect(findUnsupported(query, capabilities)).toEqual([
      { kind: 'filter', param: 'minPrice', value: '5' },
      { kind: 'sort', param: 'sort', value: 'price_desc' },
    ]);
  });

  it('ignores unsupported filters that are not in the query', () => {
    const capabilities = { filters: new Set(['q'] as const), sorts: new Set(['relevance'] as const) };
    expect(findUnsupported({ ...baseQuery, q: 'x' }, capabilities)).toEqual([]);
  });

  it('describes them for the client', () => {
    expect(
      describeUnsupported([
        { kind: 'filter', param: 'minPrice', value: '5' },
        { kind: 'sort', param: 'sort', value: 'price_desc' },
      ]),
    ).toBe("Filter 'minPrice' is not supported yet. Sort 'price_desc' is not supported yet.");
  });
});

describe('paginate', () => {
  it('returns the requested 1-based page', () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    expect(paginate([1, 2, 3, 4, 5], 3, 2)).toEqual([5]);
    expect(paginate([1, 2, 3], 4, 2)).toEqual([]);
  });
});
