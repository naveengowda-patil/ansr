import nodemailer from 'nodemailer';
import { SmtpEmailService } from './adapters/email/SmtpEmailService.js';
import {
  type CatalogueSnapshot,
  FakeStoreProductRepository,
} from './adapters/fakestore/FakeStoreProductRepository.js';
import { JsonLogger } from './adapters/logging/JsonLogger.js';
import { InMemorySearchEngine } from './adapters/search/InMemorySearchEngine.js';
import type { AppDeps } from './app.js';
import type { Config } from './config.js';
import { TtlCache } from './lib/TtlCache.js';
import type { ProductImage } from './ports/ProductRepository.js';

export interface Container {
  readonly deps: AppDeps;
  /** Releases resources (SMTP connections) on shutdown. */
  close(): void;
}

/** Composition root (blueprint §5.3): the only place that creates adapters. */
export function createContainer(config: Config): Container {
  const logger = new JsonLogger(config.logLevel, (line) => process.stdout.write(`${line}\n`));
  const now = () => Date.now();
  const cacheTiming = {
    ttlMs: config.productApi.cacheTtlSeconds * 1000,
    maxStaleAgeMs: config.productApi.staleMaxAgeSeconds * 1000,
    retryBackoffMs: config.productApi.retryBackoffSeconds * 1000,
    now,
  };

  const productRepository = new FakeStoreProductRepository({
    fetch: (url, init) => fetch(url, init),
    baseUrl: config.productApi.baseUrl,
    timeoutMs: config.productApi.timeoutMs,
    imageHostAllowlist: config.images.hostAllowlist,
    imageTimeoutMs: config.images.timeoutMs,
    imageMaxBytes: config.images.maxBytes,
    catalogueCache: new TtlCache<'catalogue', CatalogueSnapshot>({ ...cacheTiming, maxEntries: 1 }),
    imageCache: new TtlCache<number, ProductImage>({ ...cacheTiming, maxEntries: config.images.cacheMaxEntries }),
    logger,
  });

  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    ...(config.smtp.user && config.smtp.pass ? { auth: { user: config.smtp.user, pass: config.smtp.pass } } : {}),
  });

  return {
    deps: {
      productRepository,
      searchEngine: new InMemorySearchEngine(),
      emailService: new SmtpEmailService(transport),
      logger,
      settings: {
        featuredProductIds: config.featuredProductIds,
        salesInboxEmail: config.mail.salesInboxEmail,
        mailFrom: config.mail.from,
        jsonBodyLimit: config.jsonBodyLimit,
        imageClientMaxAgeSeconds: config.images.clientMaxAgeSeconds,
      },
    },
    close: () => transport.close(),
  };
}
