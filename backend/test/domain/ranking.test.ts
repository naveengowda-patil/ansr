import { describe, expect, it } from 'vitest';
import { compareByRating } from '../../src/domain/ranking.js';
import { buildProduct } from '../support/fakes.js';

describe('compareByRating (§5.5, D-003)', () => {
  it('orders by rate desc, then count desc, then id asc', () => {
    const products = [
      buildProduct({ id: 4, rating: { rate: 4.5, count: 10 } }),
      buildProduct({ id: 3, rating: { rate: 4.5, count: 10 } }),
      buildProduct({ id: 2, rating: { rate: 4.5, count: 99 } }),
      buildProduct({ id: 1, rating: { rate: 4.9, count: 1 } }),
    ];

    expect([...products].sort(compareByRating).map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });
});
