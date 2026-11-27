import { Router } from 'express';
import { z } from 'zod';
import { splitTopRated } from '../domain/categoryRanking.js';
import { sameCategory } from '../domain/search.js';
import { NotFoundError } from '../errors.js';
import { parseWith } from '../http/validate.js';
import type { ProductRepository } from '../ports/ProductRepository.js';

export interface CategoriesRouterDeps {
  readonly productRepository: ProductRepository;
}

const categoryParams = z.strictObject({ category: z.string().min(1).max(100) });

export function categoriesRouter({ productRepository }: CategoriesRouterDeps): Router {
  const router = Router();

  // §6.7
  router.get('/categories', async (_req, res) => {
    res.json({ items: await productRepository.listCategories() });
  });

  // AC-2 (§6.8). Express has already URL-decoded the param. Matches case-insensitively;
  // the response spells the category the way the data does.
  router.get('/categories/:category', async (req, res) => {
    const { category: requested } = parseWith(categoryParams, req.params);
    const inCategory = (await productRepository.getAll()).filter((product) =>
      sameCategory(product.category, requested),
    );
    const [first] = inCategory;
    if (!first) throw new NotFoundError('Category not found.');
    const { topRated, rest } = splitTopRated(inCategory);
    res.json({ category: first.category, topRated, rest });
  });

  return router;
}
