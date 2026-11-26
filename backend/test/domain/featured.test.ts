import { describe, expect, it } from 'vitest';
import { selectFeatured } from '../../src/domain/featured.js';
import { buildProduct } from '../support/fakes.js';

// Ratings chosen so the "highest rated" order is 6, 5, 4, 3, 2, 1.
const catalogue = [1, 2, 3, 4, 5, 6].map((id) => buildProduct({ id, rating: { rate: id, count: 10 } }));
const ids = (products: { id: number }[]) => products.map((p) => p.id);

describe('selectFeatured (AC-1, §5.5, D-002)', () => {
  it('keeps the configured order', () => {
    expect(ids(selectFeatured(catalogue, [2, 1, 3, 5, 4]))).toEqual([2, 1, 3, 5, 4]);
  });

  it('skips ids that do not exist and fills with the highest rated', () => {
    expect(ids(selectFeatured(catalogue, [1, 99, 2]))).toEqual([1, 2, 6, 5, 4]);
  });

  it('drops duplicate ids', () => {
    expect(ids(selectFeatured(catalogue, [1, 1, 2, 2]))).toEqual([1, 2, 6, 5, 4]);
  });

  it('fills entirely by rating when no ids are configured', () => {
    expect(ids(selectFeatured(catalogue, []))).toEqual([6, 5, 4, 3, 2]);
  });

  it('never returns more than 5, taking the first configured ids', () => {
    expect(ids(selectFeatured(catalogue, [6, 5, 4, 3, 2, 1]))).toEqual([6, 5, 4, 3, 2]);
  });

  it('returns what exists when the catalogue has fewer than 5 products', () => {
    expect(ids(selectFeatured(catalogue.slice(0, 2), [1]))).toEqual([1, 2]);
  });
});
