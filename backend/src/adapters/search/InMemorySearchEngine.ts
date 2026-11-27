import type { Product } from '../../domain/product.js';
import {
  compareForSort,
  matchesFilters,
  paginate,
  type SearchCapabilities,
  type SearchQuery,
  textSearchOnly,
} from '../../domain/search.js';
import type { ProductSearchEngine, SearchResult } from '../../ports/ProductSearchEngine.js';

export interface InMemorySearchEngineOptions {
  readonly name?: string;
  /**
   * Defaults to `textSearchOnly()`; nothing extra is enabled unless passed explicitly.
   * `allCapabilities()` also enables the additional filters and sorts (D-008).
   */
  readonly capabilities?: SearchCapabilities;
}

/**
 * Search over the cached catalogue in memory (blueprint §5.7).
 * It can apply every filter and sort, but only those in `capabilities` are reachable:
 * the route rejects anything else before calling `search`.
 */
export class InMemorySearchEngine implements ProductSearchEngine {
  readonly name: string;
  readonly capabilities: SearchCapabilities;
  private products: readonly Product[] = [];

  constructor(options: InMemorySearchEngineOptions = {}) {
    this.name = options.name ?? 'in-memory';
    this.capabilities = options.capabilities ?? textSearchOnly();
  }

  /** Re-indexing is skipped when it receives the snapshot it already holds. */
  async index(products: readonly Product[]): Promise<void> {
    if (products === this.products) return;
    this.products = products;
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const matches = this.products
      .filter((product) => matchesFilters(product, query))
      .sort(compareForSort(query.sort));
    return {
      ids: paginate(matches, query.page, query.pageSize).map((product) => product.id),
      total: matches.length,
    };
  }
}
