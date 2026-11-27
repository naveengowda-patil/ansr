import { Router } from 'express';
import { z } from 'zod';
import { buildEnquiryEmail, type EnquiryEmailSettings } from '../domain/enquiry.js';
import { NotFoundError } from '../errors.js';
import { parseBody } from '../http/validate.js';
import type { EmailService } from '../ports/EmailService.js';
import type { Logger } from '../ports/Logger.js';
import type { ProductRepository } from '../ports/ProductRepository.js';

export interface EnquiriesRouterDeps {
  readonly productRepository: ProductRepository;
  readonly emailService: EmailService;
  readonly logger: Logger;
  readonly emailSettings: EnquiryEmailSettings;
}

/** CR, LF and other control characters (header injection guard, CLAUDE.md Security). */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const noControlCharacters = (value: string) => !CONTROL_CHARACTERS.test(value);
const CONTROL_MESSAGE = 'must not contain line breaks or control characters';

/** POST /enquiries body (blueprint §6.9). Control characters are checked before trimming. */
const enquirySchema = z.strictObject({
  productId: z.number().int().positive(),
  name: z
    .string()
    .refine(noControlCharacters, CONTROL_MESSAGE)
    .transform((value) => value.trim())
    .pipe(z.string().min(1, 'is required').max(100)),
  email: z
    .string()
    .refine(noControlCharacters, CONTROL_MESSAGE)
    .transform((value) => value.trim())
    .pipe(z.email('must be a valid email address').max(254)),
  message: z.string().max(2000).optional(),
});

export function enquiriesRouter(deps: EnquiriesRouterDeps): Router {
  const { productRepository, emailService, logger } = deps;
  const router = Router();

  // AC-5
  router.post('/enquiries', async (req, res) => {
    const enquiry = parseBody(enquirySchema, req.body);
    const product = await productRepository.getById(enquiry.productId);
    if (!product) throw new NotFoundError('Product not found.');

    await emailService.send(buildEnquiryEmail(product, enquiry, deps.emailSettings, new Date()));
    // Product id and outcome only; no customer data in logs (§5.8).
    logger.info('enquiry.sent', { productId: product.id });
    res.json({ status: 'sent' });
  });

  return router;
}
