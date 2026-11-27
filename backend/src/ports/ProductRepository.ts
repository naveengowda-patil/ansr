import type { Product } from '../domain/product.js';

export interface ProductImage {
  readonly contentType: string;
  readonly data: Uint8Array;
}

/**
 * Source of truth for product data (blueprint §5.4).
 * "Not found" is `undefined`; source failures throw `UpstreamError`.
 */
export interface ProductRepository {
  /** The whole catalogue. Returns the same array instance until the catalogue changes. */
  getAll(): Promise<readonly Product[]>;
  getById(id: number): Promise<Product | undefined>;
  /** Keeps the order of `ids` and skips ids that don't exist. */
  getByIds(ids: readonly number[]): Promise<Product[]>;
  listCategories(): Promise<string[]>;
  /** The product's image (D-001). `undefined` if the product doesn't exist. */
  getImage(id: number): Promise<ProductImage | undefined>;
}
