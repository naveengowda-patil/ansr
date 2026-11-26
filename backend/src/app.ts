import express, { type Express } from 'express';
import { errorHandler, notFoundHandler } from './http/errorHandler.js';
import type { Clock } from './ports/Clock.js';
import type { EmailService } from './ports/EmailService.js';
import type { Logger } from './ports/Logger.js';
import type { ProductRepository } from './ports/ProductRepository.js';
import type { ProductSearchEngine } from './ports/ProductSearchEngine.js';
import { categoriesRouter } from './routes/categories.js';
import { enquiriesRouter } from './routes/enquiries.js';
import { healthRouter } from './routes/health.js';
import { productsRouter } from './routes/products.js';

/** Everything the HTTP app needs (blueprint §5.3). Only interfaces and plain settings. */
export interface AppDeps {
  readonly productRepository: ProductRepository;
  readonly searchEngine: ProductSearchEngine;
  readonly emailService: EmailService;
  readonly logger: Logger;
  /** Durations for debug events (§5.11). */
  readonly now: Clock;
  readonly settings: {
    readonly featuredProductIds: readonly number[];
    readonly salesInboxEmail: string;
    readonly mailFrom: string;
    readonly jsonBodyLimit: string;
    readonly imageClientMaxAgeSeconds: number;
  };
}

/** Builds the Express app without binding a port, so tests can drive it directly. */
export function createApp(deps: AppDeps): Express {
  const { productRepository, searchEngine, emailService, logger, now, settings } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: settings.jsonBodyLimit }));

  app.use(healthRouter());
  app.use(
    productsRouter({
      productRepository,
      searchEngine,
      logger,
      now,
      featuredProductIds: settings.featuredProductIds,
      imageClientMaxAgeSeconds: settings.imageClientMaxAgeSeconds,
    }),
  );
  app.use(categoriesRouter({ productRepository }));
  app.use(
    enquiriesRouter({
      productRepository,
      emailService,
      logger,
      emailSettings: { salesInboxEmail: settings.salesInboxEmail, mailFrom: settings.mailFrom },
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
