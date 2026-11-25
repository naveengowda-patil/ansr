import type { Product } from '../../domain/product.js';
import {
  allCapabilities,
  compareForSort,
  matchesFilters,
  paginate,
  type SearchCapabilities,
  type SearchQuery,
} from '../../domain/search.js';
import type { ProductSearchEngine, SearchResult } from '../../ports/ProductSearchEngine.js';

export interface InMemorySearchEngineOptions {
  readonly name?: string;
  /** Defaults to every filter and sort. Tests pass fewer to exercise the 400 path. */
  readonly capabilities?: SearchCapabilities;
}

/** Search over the cached catalogue in memory (blueprint §5.7). */
export class InMemorySearchEngine implements ProductSearchEngine {
  readonly name: string;
  readonly capabilities: SearchCapabilities;
  private products: readonly Product[] = [];

  constructor(options: InMemorySearchEngineOptions = {}) {
    this.name = options.name ?? 'in-memory';
    this.capabilities = options.capabilities ?? allCapabilities();
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
