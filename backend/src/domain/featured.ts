import type { Product } from './product.js';
import { compareByRating } from './ranking.js';

/** Number of featured products on Home (AC-1). Fixed by design, not config (D-002). */
export const FEATURED_COUNT = 5;

/**
 * Picks the featured products (blueprint §5.5, D-002):
 * configured ids in order (missing and duplicate ids skipped), then filled
 * with the highest-rated products not already included, up to `count`.
 */
export function selectFeatured(
  all: readonly Product[],
  featuredIds: readonly number[],
  count: number = FEATURED_COUNT,
): Product[] {
  const byId = new Map(all.map((product) => [product.id, product]));
  const selected: Product[] = [];
  const included = new Set<number>();

  for (const id of featuredIds) {
    if (selected.length >= count) break;
    const product = byId.get(id);
    if (product && !included.has(id)) {
      selected.push(product);
      included.add(id);
    }
  }

  if (selected.length < count) {
    const fill = all
      .filter((product) => !included.has(product.id))
      .sort(compareByRating)
      .slice(0, count - selected.length);
    selected.push(...fill);
  }

  return selected;
}
