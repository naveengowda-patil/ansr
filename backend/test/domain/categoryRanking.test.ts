import { describe, expect, it } from 'vitest';
import { splitTopRated } from '../../src/domain/categoryRanking.js';
import { buildProduct } from '../support/fakes.js';

const ids = (products: { id: number }[]) => products.map((p) => p.id);

describe('splitTopRated (AC-2, §5.5, D-004)', () => {
  const upstreamOrder = [
    buildProduct({ id: 1, rating: { rate: 2.0, count: 10 } }),
    buildProduct({ id: 2, rating: { rate: 4.8, count: 10 } }),
    buildProduct({ id: 3, rating: { rate: 1.0, count: 10 } }),
    buildProduct({ id: 4, rating: { rate: 4.8, count: 50 } }),
    buildProduct({ id: 5, rating: { rate: 3.0, count: 10 } }),
    buildProduct({ id: 6, rating: { rate: 2.5, count: 10 } }),
  ];

  it('puts the 3 highest rated first, ranked', () => {
    expect(ids(splitTopRated(upstreamOrder).topRated)).toEqual([4, 2, 5]);
  });

  it('keeps the rest in upstream order with no duplicates', () => {
    const { topRated, rest } = splitTopRated(upstreamOrder);
    expect(ids(rest)).toEqual([1, 3, 6]);
    expect(new Set([...ids(topRated), ...ids(rest)]).size).toBe(upstreamOrder.length);
  });

  it('has an empty rest for a category with 3 or fewer products', () => {
    const { topRated, rest } = splitTopRated(upstreamOrder.slice(0, 3));
    expect(ids(topRated)).toEqual([2, 1, 3]);
    expect(rest).toEqual([]);
  });
});
