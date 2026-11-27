import type { Product } from './product.js';
import { compareByRating } from './ranking.js';

/** Number of "top rated" products shown first in a category (AC-2). */
export const CATEGORY_TOP_COUNT = 3;

export interface CategorySplit {
  readonly topRated: Product[];
  readonly rest: Product[];
}

/**
 * Splits a category's products into the top rated and the rest
 * (blueprint §5.5, D-004). `rest` keeps the input (upstream) order.
 */
export function splitTopRated(
  productsInCategory: readonly Product[],
  topCount: number = CATEGORY_TOP_COUNT,
): CategorySplit {
  const topRated = [...productsInCategory].sort(compareByRating).slice(0, topCount);
  const topIds = new Set(topRated.map((product) => product.id));
  const rest = productsInCategory.filter((product) => !topIds.has(product.id));
  return { topRated, rest };
}
