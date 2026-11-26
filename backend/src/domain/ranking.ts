import type { Product } from './product.js';

/**
 * Orders products from highest to lowest rated (blueprint §5.5, D-003):
 * rating.rate desc, then rating.count desc, then id asc.
 */
export function compareByRating(a: Product, b: Product): number {
  return b.rating.rate - a.rating.rate || b.rating.count - a.rating.count || a.id - b.id;
}
