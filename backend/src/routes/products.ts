import { Router } from 'express';
import { z } from 'zod';
import { selectFeatured } from '../domain/featured.js';
import {
  describeUnsupported,
  FILTER_NAMES,
  type FilterName,
  findUnsupported,
  SORT_OPTIONS,
  type SearchQuery,
} from '../domain/search.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { nonNegativeNumberParam, positiveIntParam, productIdParams } from '../http/params.js';
import { parseQuery, parseWith } from '../http/validate.js';
import type { Clock } from '../ports/Clock.js';
import type { Logger } from '../ports/Logger.js';
import type { ProductRepository } from '../ports/ProductRepository.js';
import type { ProductSearchEngine } from '../ports/ProductSearchEngine.js';

export interface ProductsRouterDeps {
  readonly productRepository: ProductRepository;
  readonly searchEngine: ProductSearchEngine;
  readonly logger: Logger;
  readonly now: Clock;
  readonly featuredProductIds: readonly number[];
  readonly imageClientMaxAgeSeconds: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** GET /products query (blueprint §6.4). Shape only; engine support is checked separately. */
const productsQuerySchema = z
  .strictObject({
    q: z.string().trim().min(1, 'must not be blank').max(100, 'must be 100 characters or fewer').optional(),
    category: z.string().trim().min(1, 'must not be blank').max(100).optional(),
    minPrice: nonNegativeNumberParam.optional(),
    maxPrice: nonNegativeNumberParam.optional(),
    minRating: nonNegativeNumberParam.pipe(z.number().max(5, 'must be between 0 and 5')).optional(),
    sort: z.enum(SORT_OPTIONS).default('relevance'),
    page: positiveIntParam.default(1),
    pageSize: positiveIntParam
      .pipe(z.number().max(MAX_PAGE_SIZE, `must be between 1 and ${MAX_PAGE_SIZE}`))
      .default(DEFAULT_PAGE_SIZE),
  })
  .refine((query) => query.minPrice === undefined || query.maxPrice === undefined || query.minPrice <= query.maxPrice, {
    message: 'must not be greater than maxPrice',
    path: ['minPrice'],
  });

/** The filters actually present in the query, for the search.executed debug event. */
function presentFilters(query: SearchQuery): Partial<Record<FilterName, string | number>> {
  const filters: Partial<Record<FilterName, string | number>> = {};
  for (const name of FILTER_NAMES) {
    const value = query[name];
    if (name !== 'q' && value !== undefined) filters[name] = value;
  }
  return filters;
}

export function productsRouter(deps: ProductsRouterDeps): Router {
  const { productRepository, searchEngine, logger } = deps;
  const router = Router();

  // AC-1 (§6.3)
  router.get('/products/featured', async (_req, res) => {
    const items = selectFeatured(await productRepository.getAll(), deps.featuredProductIds);
    res.json({ items });
  });

  // AC-3 search and listing (§5.7, §6.4)
  router.get('/products', async (req, res) => {
    const query: SearchQuery = parseQuery(productsQuerySchema, req.query);

    const unsupported = findUnsupported(query, searchEngine.capabilities);
    if (unsupported.length > 0) {
      for (const item of unsupported) {
        logger.warn('search.unsupported', { param: item.param, value: item.value, engine: searchEngine.name });
      }
      throw new ValidationError(describeUnsupported(unsupported));
    }

    const startedAt = deps.now();
    await searchEngine.index(await productRepository.getAll());
    const { ids, total } = await searchEngine.search(query);
    const items = await productRepository.getByIds(ids);
    logger.debug('search.executed', {
      q: query.q,
      filters: presentFilters(query),
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
      total,
      durationMs: Math.round(deps.now() - startedAt),
    });
    res.json({ items, total, page: query.page, pageSize: query.pageSize });
  });

  // AC-4 (§6.5)
  router.get('/products/:id', async (req, res) => {
    const { id } = parseWith(productIdParams, req.params);
    const product = await productRepository.getById(id);
    if (!product) throw new NotFoundError('Product not found.');
    res.json(product);
  });

  // Image proxy (§6.6, D-001)
  router.get('/products/:id/image', async (req, res) => {
    const { id } = parseWith(productIdParams, req.params);
    const image = await productRepository.getImage(id);
    if (!image) throw new NotFoundError('Product not found.');
    res.set({
      'Content-Type': image.contentType,
      'Cache-Control': `public, max-age=${deps.imageClientMaxAgeSeconds}`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength));
  });

  return router;
}
