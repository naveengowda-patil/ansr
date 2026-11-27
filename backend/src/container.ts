import nodemailer from 'nodemailer';
import { type MailTransport, SmtpEmailService } from './adapters/email/SmtpEmailService.js';
import {
  type CatalogueSnapshot,
  FakeStoreProductRepository,
  type FetchFn,
} from './adapters/fakestore/FakeStoreProductRepository.js';
import { JsonLogger } from './adapters/logging/JsonLogger.js';
import { InMemorySearchEngine } from './adapters/search/InMemorySearchEngine.js';
import type { AppDeps } from './app.js';
import { type Config, safeConfigSummary } from './config.js';
import { textSearchOnly } from './domain/search.js';
import { TtlCache } from './lib/TtlCache.js';
import type { Clock } from './ports/Clock.js';
import type { ProductImage } from './ports/ProductRepository.js';

export interface Container {
  readonly deps: AppDeps;
  /** Releases resources (SMTP connections) on shutdown. */
  close(): void;
  /** Resolves when the catalogue and image caches have no background refresh in flight. */
  whenIdle(): Promise<void>;
}

/** Options handed to the SMTP transport factory (blueprint §5.8). */
export interface SmtpTransportOptions {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly connectionTimeout: number;
  readonly greetingTimeout: number;
  readonly socketTimeout: number;
  readonly auth?: { readonly user: string; readonly pass: string };
}

export interface ClosableMailTransport extends MailTransport {
  close(): void;
}

export type MailTransportFactory = (options: SmtpTransportOptions) => ClosableMailTransport;

/** Test seams at the composition root. Production uses the defaults. */
export interface ContainerOverrides {
  /** Defaults to nodemailer.createTransport. Tests pass a spy to check the options. */
  readonly createMailTransport?: MailTransportFactory;
  /** Defaults to the global fetch. Tests pass a fake so nothing touches the network. */
  readonly fetch?: FetchFn;
  /** Where JSON log lines go. Defaults to stdout. */
  readonly writeLog?: (line: string) => void;
  /** Clock for cache ages and debug durations. Defaults to performance.now(). Tests pass a fake. */
  readonly now?: Clock;
}

/**
 * SMTP transport options from config. Every timeout is SMTP_TIMEOUT_MS, so a hanging
 * mail server can't stall an enquiry for nodemailer's multi-minute defaults (D-010).
 */
export function smtpTransportOptions(smtp: Config['smtp']): SmtpTransportOptions {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    connectionTimeout: smtp.timeoutMs,
    greetingTimeout: smtp.timeoutMs,
    socketTimeout: smtp.timeoutMs,
    ...(smtp.user && smtp.pass ? { auth: { user: smtp.user, pass: smtp.pass } } : {}),
  };
}

/** Composition root (blueprint §5.3): the only place that creates adapters. */
export function createContainer(config: Config, overrides: ContainerOverrides = {}): Container {
  const logger = new JsonLogger(
    config.logLevel,
    overrides.writeLog ?? ((line) => process.stdout.write(`${line}\n`)),
  );
  logger.debug('config.loaded', safeConfigSummary(config));
  // One monotonic clock for cache ages and debug durations (§5.11).
  const now: Clock = overrides.now ?? (() => performance.now());
  const cacheTiming = {
    ttlMs: config.productApi.cacheTtlSeconds * 1000,
    maxStaleAgeMs: config.productApi.staleMaxAgeSeconds * 1000,
    retryBackoffMs: config.productApi.retryBackoffSeconds * 1000,
    now,
  };

  const catalogueCache = new TtlCache<'catalogue', CatalogueSnapshot>({
    ...cacheTiming,
    name: 'catalogue',
    logger,
    maxEntries: 1,
  });
  const imageCache = new TtlCache<number, ProductImage>({
    ...cacheTiming,
    name: 'image',
    logger,
    maxEntries: config.images.cacheMaxEntries,
  });

  const productRepository = new FakeStoreProductRepository({
    fetch: overrides.fetch ?? ((url, init) => fetch(url, init)),
    baseUrl: config.productApi.baseUrl,
    timeoutMs: config.productApi.timeoutMs,
    imageHostAllowlist: config.images.hostAllowlist,
    imageTimeoutMs: config.images.timeoutMs,
    imageMaxBytes: config.images.maxBytes,
    catalogueCache,
    imageCache,
    logger,
    now,
  });

  const createMailTransport: MailTransportFactory =
    overrides.createMailTransport ?? ((options) => nodemailer.createTransport(options));
  const transport = createMailTransport(smtpTransportOptions(config.smtp));

  return {
    deps: {
      productRepository,
      // The running app does text search only (D-008). Pass allCapabilities() to enable the
      // additional filters and sorts, which are built and unit-tested.
      searchEngine: new InMemorySearchEngine({ capabilities: textSearchOnly() }),
      emailService: new SmtpEmailService(transport, logger, now),
      logger,
      now,
      settings: {
        featuredProductIds: config.featuredProductIds,
        salesInboxEmail: config.mail.salesInboxEmail,
        mailFrom: config.mail.from,
        jsonBodyLimit: config.jsonBodyLimit,
        imageClientMaxAgeSeconds: config.images.clientMaxAgeSeconds,
      },
    },
    close: () => transport.close(),
    whenIdle: async () => {
      await Promise.all([catalogueCache.whenIdle(), imageCache.whenIdle()]);
    },
  };
}
