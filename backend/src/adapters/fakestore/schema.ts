import { z } from 'zod';

/**
 * Shape of `GET {baseUrl}/products` from Fake Store. Extra upstream fields are
 * ignored (stripped) so additive upstream changes don't break us.
 */
export const fakeStoreProductSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  price: z.number().nonnegative(),
  description: z.string(),
  category: z.string(),
  image: z.string(),
  rating: z.object({
    rate: z.number().min(0).max(5),
    count: z.number().int().nonnegative(),
  }),
});

export const fakeStoreProductsSchema = z.array(fakeStoreProductSchema);

export type FakeStoreProduct = z.infer<typeof fakeStoreProductSchema>;
