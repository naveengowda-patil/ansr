import type { Product } from '../domain/product.js';
import type { SearchCapabilities, SearchQuery } from '../domain/search.js';

export interface SearchResult {
  /** Ids of the requested page only, in result order. */
  readonly ids: number[];
  /** Total number of matches across all pages. */
  readonly total: number;
}

/**
 * Finds product ids; never the source of product data (blueprint §5.4, §5.7, D-008, D-027).
 * The route rejects queries using anything outside `capabilities` before calling `search`.
 */
export interface ProductSearchEngine {
  /** Used in logs, e.g. "in-memory". */
  readonly name: string;
  readonly capabilities: SearchCapabilities;
  index(products: readonly Product[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult>;
}
