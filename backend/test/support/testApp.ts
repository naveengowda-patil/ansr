import type { Express } from 'express';
import { InMemorySearchEngine } from '../../src/adapters/search/InMemorySearchEngine.js';
import { type AppDeps, createApp } from '../../src/app.js';
import type { Product } from '../../src/domain/product.js';
import type { Clock } from '../../src/ports/Clock.js';
import type { ProductRepository } from '../../src/ports/ProductRepository.js';
import type { ProductSearchEngine } from '../../src/ports/ProductSearchEngine.js';
import { FakeProductRepository, RecordingEmailService, RecordingLogger } from './fakes.js';

export const TEST_SETTINGS: AppDeps['settings'] = {
  featuredProductIds: [],
  salesInboxEmail: 'sales@example.test',
  mailFrom: 'catalogue@example.test',
  jsonBodyLimit: '10kb',
  imageClientMaxAgeSeconds: 600,
};

export interface TestAppOptions {
  readonly products?: readonly Product[];
  readonly productRepository?: ProductRepository;
  readonly searchEngine?: ProductSearchEngine;
  readonly settings?: Partial<AppDeps['settings']>;
  /** Defaults to a clock stuck at 0. */
  readonly now?: Clock;
}

export interface TestApp {
  readonly app: Express;
  readonly emailService: RecordingEmailService;
  readonly logger: RecordingLogger;
}

/** createApp wired with in-memory fakes; never touches the network. */
export function createTestApp(options: TestAppOptions = {}): TestApp {
  const emailService = new RecordingEmailService();
  const logger = new RecordingLogger();
  const app = createApp({
    productRepository: options.productRepository ?? new FakeProductRepository(options.products ?? []),
    searchEngine: options.searchEngine ?? new InMemorySearchEngine(),
    emailService,
    logger,
    now: options.now ?? (() => 0),
    settings: { ...TEST_SETTINGS, ...options.settings },
  });
  return { app, emailService, logger };
}
