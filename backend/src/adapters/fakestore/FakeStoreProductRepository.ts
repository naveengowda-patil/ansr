import type { Product } from '../../domain/product.js';
import { UpstreamError } from '../../errors.js';
import type { CacheResult, TtlCache } from '../../lib/TtlCache.js';
import type { Logger } from '../../ports/Logger.js';
import type { ProductImage, ProductRepository } from '../../ports/ProductRepository.js';
import { type FakeStoreProduct, fakeStoreProductsSchema } from './schema.js';

/** Fake Store prices carry no currency; they are USD (D-020). */
const FAKE_STORE_CURRENCY = 'USD';

/** Raster types the app can render. SVG is excluded because it can carry scripts (D-001). */
const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export type FetchFn = (url: URL, init: RequestInit) => Promise<Response>;

/** One loaded copy of the catalogue. `products` keeps its identity until the next refetch. */
export interface CatalogueSnapshot {
  readonly products: readonly Product[];
  readonly byId: ReadonlyMap<number, Product>;
  /** Upstream image URLs, internal to this adapter (D-019). */
  readonly imageUrlById: ReadonlyMap<number, string>;
}

export interface FakeStoreProductRepositoryOptions {
  readonly fetch: FetchFn;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly imageHostAllowlist: readonly string[];
  readonly imageTimeoutMs: number;
  readonly imageMaxBytes: number;
  readonly catalogueCache: TtlCache<'catalogue', CatalogueSnapshot>;
  readonly imageCache: TtlCache<number, ProductImage>;
  readonly logger: Logger;
}

/** `ProductRepository` backed by fakestoreapi.com (blueprint §5.6). */
export class FakeStoreProductRepository implements ProductRepository {
  constructor(private readonly options: FakeStoreProductRepositoryOptions) {}

  async getAll(): Promise<readonly Product[]> {
    return (await this.snapshot()).products;
  }

  async getById(id: number): Promise<Product | undefined> {
    return (await this.snapshot()).byId.get(id);
  }

  async getByIds(ids: readonly number[]): Promise<Product[]> {
    const { byId } = await this.snapshot();
    return ids.flatMap((id) => {
      const product = byId.get(id);
      return product ? [product] : [];
    });
  }

  async listCategories(): Promise<string[]> {
    const { products } = await this.snapshot();
    return [...new Set(products.map((product) => product.category))];
  }

  async getImage(id: number): Promise<ProductImage | undefined> {
    const imageUrl = (await this.snapshot()).imageUrlById.get(id);
    if (imageUrl === undefined) return undefined;
    const result = await this.options.imageCache.get(id, () => this.fetchImage(imageUrl));
    this.logIfStale('image.stale_served', result, { productId: id });
    return result.value;
  }

  private async snapshot(): Promise<CatalogueSnapshot> {
    const result = await this.options.catalogueCache.get('catalogue', () => this.fetchCatalogue());
    this.logIfStale('catalogue.stale_served', result);
    return result.value;
  }

  /** Warns once per failed refresh; stale copies served inside the back-off window are not re-logged. */
  private logIfStale(event: string, result: CacheResult<unknown>, context: Record<string, unknown> = {}): void {
    if (!result.stale || !result.refreshAttempted) return;
    this.options.logger.warn(event, {
      ...context,
      ageSeconds: Math.round(result.ageMs / 1000),
      reason: describeError(result.error),
    });
  }

  private async fetchCatalogue(): Promise<CatalogueSnapshot> {
    const url = new URL('products', withTrailingSlash(this.options.baseUrl));
    let response: Response;
    try {
      response = await this.options.fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw new UpstreamError('Product source request failed', { cause: error });
    }
    if (!response.ok) {
      await discardBody(response);
      throw new UpstreamError(`Product source responded with HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new UpstreamError('Product source returned invalid JSON', { cause: error });
    }
    const parsed = fakeStoreProductsSchema.safeParse(body);
    if (!parsed.success) {
      throw new UpstreamError('Product source returned an unexpected shape', { cause: parsed.error });
    }
    return toSnapshot(parsed.data);
  }

  /** Applies the image guards from blueprint §5.6 (D-001). */
  private async fetchImage(imageUrl: string): Promise<ProductImage> {
    const url = this.allowedImageUrl(imageUrl);

    let response: Response;
    try {
      response = await this.options.fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(this.options.imageTimeoutMs),
      });
    } catch (error) {
      throw new UpstreamError('Image request failed', { cause: error });
    }
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      await discardBody(response);
      throw new UpstreamError('Image request was redirected');
    }
    if (!response.ok) {
      await discardBody(response);
      throw new UpstreamError(`Image source responded with HTTP ${response.status}`);
    }

    const contentType = mediaType(response.headers.get('content-type'));
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      await discardBody(response);
      throw new UpstreamError(`Image source returned disallowed content type "${contentType}"`);
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > this.options.imageMaxBytes) {
      await discardBody(response);
      throw new UpstreamError(`Image is larger than ${this.options.imageMaxBytes} bytes`);
    }

    const data = await readBodyWithLimit(response, this.options.imageMaxBytes);
    return { contentType, data };
  }

  private allowedImageUrl(imageUrl: string): URL {
    let url: URL;
    try {
      url = new URL(imageUrl);
    } catch (error) {
      throw new UpstreamError('Product has an invalid image URL', { cause: error });
    }
    const allowedHosts = this.options.imageHostAllowlist.map((host) => host.toLowerCase());
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !allowedHosts.includes(url.hostname.toLowerCase())) {
      throw new UpstreamError(`Image host "${url.hostname}" is not in the allowlist`);
    }
    return url;
  }
}

function toSnapshot(items: readonly FakeStoreProduct[]): CatalogueSnapshot {
  const products: Product[] = items.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    category: item.category,
    price: item.price,
    currency: FAKE_STORE_CURRENCY,
    rating: { rate: item.rating.rate, count: item.rating.count },
  }));
  return {
    products,
    byId: new Map(products.map((product) => [product.id, product])),
    imageUrlById: new Map(items.map((item) => [item.id, item.image])),
  };
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new UpstreamError('Image response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new UpstreamError(`Image is larger than ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError('Reading the image failed', { cause: error });
  }

  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing useful to do; the response is being rejected anyway.
  }
}

/** "Image/PNG; charset=binary" → "image/png". */
function mediaType(header: string | null): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function withTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
