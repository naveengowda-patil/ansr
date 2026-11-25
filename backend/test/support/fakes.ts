import type { EmailMessage } from '../../src/domain/email.js';
import type { Product } from '../../src/domain/product.js';
import { allCapabilities, type SearchCapabilities, type SearchQuery } from '../../src/domain/search.js';
import type { EmailService } from '../../src/ports/EmailService.js';
import type { LogContext, Logger, LogLevel } from '../../src/ports/Logger.js';
import type { ProductImage, ProductRepository } from '../../src/ports/ProductRepository.js';
import type { ProductSearchEngine, SearchResult } from '../../src/ports/ProductSearchEngine.js';

/** Builds a product with sensible defaults. */
export function buildProduct(overrides: Partial<Product> & { id: number }): Product {
  return {
    title: `Product ${overrides.id}`,
    description: `Description of product ${overrides.id}`,
    category: 'electronics',
    price: 10,
    currency: 'USD',
    rating: { rate: 3, count: 100 },
    ...overrides,
  };
}

/** In-memory ProductRepository. Set `failure` to make every call throw it. */
export class FakeProductRepository implements ProductRepository {
  failure: Error | undefined;
  private readonly products: readonly Product[];

  constructor(
    products: readonly Product[],
    private readonly images: ReadonlyMap<number, ProductImage> = new Map(),
  ) {
    this.products = products;
  }

  async getAll(): Promise<readonly Product[]> {
    this.throwIfFailing();
    return this.products;
  }

  async getById(id: number): Promise<Product | undefined> {
    this.throwIfFailing();
    return this.products.find((product) => product.id === id);
  }

  async getByIds(ids: readonly number[]): Promise<Product[]> {
    this.throwIfFailing();
    return ids.flatMap((id) => this.products.filter((product) => product.id === id));
  }

  async listCategories(): Promise<string[]> {
    this.throwIfFailing();
    return [...new Set(this.products.map((product) => product.category))];
  }

  async getImage(id: number): Promise<ProductImage | undefined> {
    this.throwIfFailing();
    return this.images.get(id);
  }

  private throwIfFailing(): void {
    if (this.failure) throw this.failure;
  }
}

/** Search engine that supports everything, records queries and returns a canned result. */
export class RecordingSearchEngine implements ProductSearchEngine {
  readonly name = 'recording-fake';
  readonly capabilities: SearchCapabilities = allCapabilities();
  readonly queries: SearchQuery[] = [];
  indexed: readonly Product[] | undefined;

  constructor(private readonly result: SearchResult) {}

  async index(products: readonly Product[]): Promise<void> {
    this.indexed = products;
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    this.queries.push(query);
    return this.result;
  }
}

/** EmailService that records messages. Set `failure` to make `send` throw it. */
export class RecordingEmailService implements EmailService {
  readonly sent: EmailMessage[] = [];
  failure: Error | undefined;

  async send(message: EmailMessage): Promise<void> {
    if (this.failure) throw this.failure;
    this.sent.push(message);
  }
}

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly context: LogContext;
}

/** Logger that keeps entries in memory for assertions. */
export class RecordingLogger implements Logger {
  readonly entries: LogEntry[] = [];

  debug(message: string, context: LogContext = {}): void {
    this.entries.push({ level: 'debug', message, context });
  }

  info(message: string, context: LogContext = {}): void {
    this.entries.push({ level: 'info', message, context });
  }

  warn(message: string, context: LogContext = {}): void {
    this.entries.push({ level: 'warn', message, context });
  }

  error(message: string, context: LogContext = {}): void {
    this.entries.push({ level: 'error', message, context });
  }

  withMessage(message: string): LogEntry[] {
    return this.entries.filter((entry) => entry.message === message);
  }
}
