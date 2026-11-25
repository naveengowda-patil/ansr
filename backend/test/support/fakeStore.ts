import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import {
  type CatalogueSnapshot,
  FakeStoreProductRepository,
  type FetchFn,
} from '../../src/adapters/fakestore/FakeStoreProductRepository.js';
import { TtlCache } from '../../src/lib/TtlCache.js';
import type { ProductImage } from '../../src/ports/ProductRepository.js';
import { RecordingLogger } from './fakes.js';

/** Recorded from https://fakestoreapi.com/products on 2026-11-25. */
export const productsFixture: unknown = JSON.parse(
  readFileSync(new URL('../fixtures/fakestore/products.json', import.meta.url), 'utf8'),
);

export const TTL_MS = 300_000;
export const MAX_STALE_MS = 86_400_000;
export const BACKOFF_MS = 30_000;
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type Route = (url: URL, init: RequestInit) => Promise<Response> | Response;

export interface FakeStoreOptions {
  readonly products?: Route;
  readonly image?: Route;
  readonly imageMaxBytes?: number;
  readonly imageHostAllowlist?: readonly string[];
  readonly timeoutMs?: number;
}

/**
 * The real FakeStoreProductRepository with an injected fetch (recorded fixture by default),
 * a controllable clock and a recording logger. Never touches the network.
 */
export function createFakeStoreRepository(options: FakeStoreOptions = {}) {
  let time = 0;
  const now = () => time;
  const logger = new RecordingLogger();
  const products: Route = options.products ?? (() => Response.json(productsFixture));
  const image: Route =
    options.image ?? (() => new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } }));
  const fetch = vi.fn<FetchFn>(async (url, init) =>
    url.pathname === '/products' ? products(url, init) : image(url, init),
  );
  const cacheTiming = { ttlMs: TTL_MS, maxStaleAgeMs: MAX_STALE_MS, retryBackoffMs: BACKOFF_MS, now };

  const repository = new FakeStoreProductRepository({
    fetch,
    baseUrl: 'https://fakestoreapi.com',
    timeoutMs: options.timeoutMs ?? 1_000,
    imageHostAllowlist: options.imageHostAllowlist ?? ['fakestoreapi.com'],
    imageTimeoutMs: options.timeoutMs ?? 1_000,
    imageMaxBytes: options.imageMaxBytes ?? 1_024,
    catalogueCache: new TtlCache<'catalogue', CatalogueSnapshot>({ ...cacheTiming, maxEntries: 1 }),
    imageCache: new TtlCache<number, ProductImage>({ ...cacheTiming, maxEntries: 10 }),
    logger,
  });

  return {
    repository,
    fetch,
    logger,
    advance: (ms: number) => {
      time += ms;
    },
    catalogueCalls: () => fetch.mock.calls.filter(([url]) => url.pathname === '/products'),
    imageCalls: () => fetch.mock.calls.filter(([url]) => url.pathname !== '/products'),
  };
}

/** A fetch that only settles when its abort signal fires (simulates a hung upstream). */
export const neverResolvesUntilAborted: Route = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

export function imageResponse(contentType: string, body: Uint8Array | string = PNG_BYTES): Response {
  return new Response(body, { headers: { 'content-type': contentType } });
}
