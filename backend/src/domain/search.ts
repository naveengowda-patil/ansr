import type { Product } from './product.js';
import { compareByRating } from './ranking.js';

/** Search types and rules (blueprint §5.4, §5.5, §5.7, D-007, D-008). */

export const FILTER_NAMES = ['q', 'category', 'minPrice', 'maxPrice', 'minRating'] as const;
export type FilterName = (typeof FILTER_NAMES)[number];

export const SORT_OPTIONS = ['relevance', 'rating_desc', 'price_asc', 'price_desc', 'title_asc'] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export interface SearchQuery {
  q?: string | undefined;
  category?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  minRating?: number | undefined;
  sort: SortOption;
  page: number;
  pageSize: number;
}

export interface SearchCapabilities {
  readonly filters: ReadonlySet<FilterName>;
  readonly sorts: ReadonlySet<SortOption>;
}

/**
 * What the running app supports (D-008): text search (`q`) in upstream order.
 * Paging is always supported and not listed.
 */
export function textSearchOnly(): SearchCapabilities {
  return { filters: new Set<FilterName>(['q']), sorts: new Set<SortOption>(['relevance']) };
}

/**
 * Every filter and sort, including the additional ones that are built and
 * unit-tested but not enabled in the running app (D-008).
 */
export function allCapabilities(): SearchCapabilities {
  return { filters: new Set(FILTER_NAMES), sorts: new Set(SORT_OPTIONS) };
}

export interface UnsupportedParam {
  readonly kind: 'filter' | 'sort';
  readonly param: string;
  readonly value: string;
}

/** Filters present in the query, and the sort, that the engine does not support. */
export function findUnsupported(query: SearchQuery, capabilities: SearchCapabilities): UnsupportedParam[] {
  const unsupported: UnsupportedParam[] = [];
  for (const name of FILTER_NAMES) {
    const value = query[name];
    if (value !== undefined && !capabilities.filters.has(name)) {
      unsupported.push({ kind: 'filter', param: name, value: String(value) });
    }
  }
  if (!capabilities.sorts.has(query.sort)) {
    unsupported.push({ kind: 'sort', param: 'sort', value: query.sort });
  }
  return unsupported;
}

/** Client-facing message for unsupported params. */
export function describeUnsupported(params: readonly UnsupportedParam[]): string {
  return params
    .map((item) =>
      item.kind === 'sort'
        ? `Sort '${item.value}' is not supported yet.`
        : `Filter '${item.param}' is not supported yet.`,
    )
    .join(' ');
}

/** Case-insensitive phrase match on title, description or category. `q` must already be trimmed. */
export function matchesText(product: Product, q: string): boolean {
  const needle = q.toLowerCase();
  return (
    product.title.toLowerCase().includes(needle) ||
    product.description.toLowerCase().includes(needle) ||
    product.category.toLowerCase().includes(needle)
  );
}

/** Category names compare case-insensitively everywhere (D-004). */
export function sameCategory(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Every filter present in the query must hold (AND). Price bounds are inclusive.
 * `q` is enabled in the running app. `category`, `minPrice`, `maxPrice` and `minRating`
 * are additional: built and unit-tested, not enabled in the running app (D-008).
 */
export function matchesFilters(product: Product, query: SearchQuery): boolean {
  if (query.q !== undefined && !matchesText(product, query.q)) return false;
  if (query.category !== undefined && !sameCategory(product.category, query.category)) return false;
  if (query.minPrice !== undefined && product.price < query.minPrice) return false;
  if (query.maxPrice !== undefined && product.price > query.maxPrice) return false;
  if (query.minRating !== undefined && product.rating.rate < query.minRating) return false;
  return true;
}

/**
 * Comparator for a sort option. `relevance` keeps the input order (Array.prototype.sort is
 * stable) and is enabled in the running app. `rating_desc`, `price_asc`, `price_desc` and
 * `title_asc` are additional: built and unit-tested, not enabled in the running app (D-008).
 */
export function compareForSort(sort: SortOption): (a: Product, b: Product) => number {
  switch (sort) {
    case 'relevance':
      return () => 0;
    case 'rating_desc':
      return compareByRating;
    case 'price_asc':
      return (a, b) => a.price - b.price || a.id - b.id;
    case 'price_desc':
      return (a, b) => b.price - a.price || a.id - b.id;
    case 'title_asc':
      return (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || a.id - b.id;
  }
}

/** One page of items (1-based page). */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
