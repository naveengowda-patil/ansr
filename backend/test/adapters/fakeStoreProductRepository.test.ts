import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  type CatalogueSnapshot,
  FakeStoreProductRepository,
  type FetchFn,
} from '../../src/adapters/fakestore/FakeStoreProductRepository.js';
import { UpstreamError } from '../../src/errors.js';
import { TtlCache } from '../../src/lib/TtlCache.js';
import type { ProductImage } from '../../src/ports/ProductRepository.js';
import { RecordingLogger } from '../support/fakes.js';

/** Recorded from https://fakestoreapi.com/products on 2026-11-25. */
const productsFixture: unknown = JSON.parse(
  readFileSync(new URL('../fixtures/fakestore/products.json', import.meta.url), 'utf8'),
);

const BASE_URL = 'https://fakestoreapi.com';
const TTL_MS = 300_000;
const MAX_STALE_MS = 86_400_000;
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Route = (url: URL, init: RequestInit) => Promise<Response> | Response;

interface SetupOptions {
  readonly products?: Route;
  readonly image?: Route;
  readonly imageMaxBytes?: number;
  readonly imageHostAllowlist?: readonly string[];
  readonly timeoutMs?: number;
}

function setup(options: SetupOptions = {}) {
  let time = 0;
  const now = () => time;
  const logger = new RecordingLogger();
  const products: Route = options.products ?? (() => Response.json(productsFixture));
  const image: Route =
    options.image ?? (() => new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } }));
  const fetch = vi.fn<FetchFn>(async (url, init) =>
    url.pathname === '/products' ? products(url, init) : image(url, init),
  );

  const repository = new FakeStoreProductRepository({
    fetch,
    baseUrl: BASE_URL,
    timeoutMs: options.timeoutMs ?? 1_000,
    imageHostAllowlist: options.imageHostAllowlist ?? ['fakestoreapi.com'],
    imageTimeoutMs: options.timeoutMs ?? 1_000,
    imageMaxBytes: options.imageMaxBytes ?? 1_024,
    catalogueCache: new TtlCache<'catalogue', CatalogueSnapshot>({
      ttlMs: TTL_MS,
      maxStaleAgeMs: MAX_STALE_MS,
      maxEntries: 1,
      now,
    }),
    imageCache: new TtlCache<number, ProductImage>({ ttlMs: TTL_MS, maxStaleAgeMs: MAX_STALE_MS, maxEntries: 10, now }),
    logger,
  });

  return {
    repository,
    fetch,
    logger,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const neverResolvesUntilAborted: Route = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

const imageCalls = (fetch: ReturnType<typeof setup>['fetch']) =>
  fetch.mock.calls.filter(([url]) => url.pathname !== '/products');

describe('FakeStoreProductRepository (§5.6)', () => {
  describe('mapping', () => {
    it('maps the recorded catalogue to products with USD and no image URL', async () => {
      const { repository } = setup();
      const all = await repository.getAll();

      expect(all).toHaveLength(20);
      expect(all[0]).toEqual({
        id: 1,
        title: 'Fjallraven - Foldsack No. 1 Backpack, Fits 15 Laptops',
        description: expect.any(String),
        category: "men's clothing",
        price: 109.95,
        currency: 'USD',
        rating: { rate: 3.9, count: 120 },
      });
      expect(all[0]).not.toHaveProperty('image');
    });

    it('looks up by id and by ids, keeping order and skipping missing ids', async () => {
      const { repository } = setup();

      expect((await repository.getById(3))?.id).toBe(3);
      expect(await repository.getById(999)).toBeUndefined();
      expect((await repository.getByIds([5, 999, 2])).map((p) => p.id)).toEqual([5, 2]);
    });

    it('lists distinct categories in first-seen order', async () => {
      const { repository } = setup();
      expect(await repository.listCategories()).toEqual([
        "men's clothing",
        'jewelery',
        'electronics',
        "women's clothing",
      ]);
    });

    it('calls the configured base URL with a timeout signal', async () => {
      const { repository, fetch } = setup();
      await repository.getAll();

      const [url, init] = fetch.mock.calls[0] ?? [];
      expect(url?.toString()).toBe('https://fakestoreapi.com/products');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('upstream failures', () => {
    it('times out a slow upstream', async () => {
      const { repository } = setup({ products: neverResolvesUntilAborted, timeoutMs: 20 });
      await expect(repository.getAll()).rejects.toBeInstanceOf(UpstreamError);
    });

    it('rejects a non-2xx response', async () => {
      const { repository } = setup({ products: () => new Response('down', { status: 503 }) });
      await expect(repository.getAll()).rejects.toThrow('HTTP 503');
    });

    it('rejects a response with an unexpected shape', async () => {
      const { repository } = setup({ products: () => Response.json([{ id: 'one' }]) });
      await expect(repository.getAll()).rejects.toThrow('unexpected shape');
    });

    it('rejects a body that is not JSON', async () => {
      const { repository } = setup({ products: () => new Response('<html>', { status: 200 }) });
      await expect(repository.getAll()).rejects.toThrow('invalid JSON');
    });
  });

  describe('cache with stale fallback (D-011)', () => {
    it('fresh: serves from the cache without calling upstream', async () => {
      const { repository, fetch, advance } = setup();
      const first = await repository.getAll();
      advance(TTL_MS - 1);

      expect(await repository.getAll()).toBe(first);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('expired + refetch ok: serves the new copy', async () => {
      let title = 'Old title';
      const { repository, fetch, advance } = setup({
        products: () => Response.json([{ ...firstFixtureProduct(), title }]),
      });
      await repository.getAll();
      title = 'New title';
      advance(TTL_MS);

      expect((await repository.getAll())[0]?.title).toBe('New title');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('expired + refetch fails: serves the stale copy and logs a warning', async () => {
      let up = true;
      const { repository, logger, advance } = setup({
        products: () => (up ? Response.json(productsFixture) : new Response('down', { status: 500 })),
      });
      const first = await repository.getAll();
      up = false;
      advance(TTL_MS + 60_000);

      expect(await repository.getAll()).toBe(first);
      expect(logger.withMessage('catalogue.stale_served')).toEqual([
        { level: 'warn', message: 'catalogue.stale_served', context: { ageSeconds: 360, reason: 'Product source responded with HTTP 500' } },
      ]);
    });

    it('stale copy older than the 24 h cap + refetch fails: throws', async () => {
      let up = true;
      const { repository, advance } = setup({
        products: () => (up ? Response.json(productsFixture) : new Response('down', { status: 500 })),
      });
      await repository.getAll();
      up = false;
      advance(MAX_STALE_MS + 1);

      await expect(repository.getAll()).rejects.toBeInstanceOf(UpstreamError);
    });

    it('no copy + failure: throws UpstreamError', async () => {
      const { repository } = setup({ products: () => new Response('down', { status: 500 }) });
      await expect(repository.getAll()).rejects.toBeInstanceOf(UpstreamError);
    });
  });

  describe('image proxy guards (D-001)', () => {
    it('returns the image bytes and content type', async () => {
      const { repository, fetch } = setup();
      const image = await repository.getImage(1);

      expect(image).toEqual({ contentType: 'image/png', data: PNG_BYTES });
      const [url, init] = imageCalls(fetch)[0] ?? [];
      expect(url?.toString()).toBe('https://fakestoreapi.com/img/81fPKd-2AYL._AC_SL1500_t.png');
      expect(init?.redirect).toBe('error');
    });

    it('returns undefined for an unknown product without fetching', async () => {
      const { repository, fetch } = setup();
      expect(await repository.getImage(999)).toBeUndefined();
      expect(imageCalls(fetch)).toHaveLength(0);
    });

    it('host not in the allowlist: rejected without making a request', async () => {
      const { repository, fetch } = setup({ imageHostAllowlist: ['images.example.test'] });
      await expect(repository.getImage(1)).rejects.toThrow('not in the allowlist');
      expect(imageCalls(fetch)).toHaveLength(0);
    });

    it('redirect: rejected', async () => {
      const { repository } = setup({
        image: (_url, init) => {
          // Mirrors fetch: with redirect "error" a redirect rejects; otherwise it is a 3xx.
          if (init.redirect === 'error') throw new TypeError('unexpected redirect');
          return new Response(null, { status: 302, headers: { location: 'https://evil.example.test/x.png' } });
        },
      });
      await expect(repository.getImage(1)).rejects.toBeInstanceOf(UpstreamError);
    });

    it('3xx response that slipped through: rejected', async () => {
      const { repository } = setup({
        image: () => new Response(null, { status: 302, headers: { location: 'https://evil.example.test/x.png' } }),
      });
      await expect(repository.getImage(1)).rejects.toThrow('redirected');
    });

    it('timeout: rejected', async () => {
      const { repository } = setup({ image: neverResolvesUntilAborted, timeoutMs: 20 });
      await expect(repository.getImage(1)).rejects.toThrow('Image request failed');
    });

    it('non-image content type: rejected', async () => {
      const { repository } = setup({
        image: () => new Response('<script>', { headers: { 'content-type': 'text/html' } }),
      });
      await expect(repository.getImage(1)).rejects.toThrow('non-image content type');
    });

    it('too large by Content-Length: rejected', async () => {
      const { repository } = setup({
        imageMaxBytes: 4,
        image: () => new Response(PNG_BYTES, { headers: { 'content-type': 'image/png', 'content-length': '8' } }),
      });
      await expect(repository.getImage(1)).rejects.toThrow('larger than 4 bytes');
    });

    it('too large by streamed body (no Content-Length): rejected', async () => {
      const { repository } = setup({
        imageMaxBytes: 4,
        image: () => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(PNG_BYTES.slice(0, 3));
              controller.enqueue(PNG_BYTES.slice(3));
              controller.close();
            },
          });
          return new Response(body, { headers: { 'content-type': 'image/png' } });
        },
      });
      await expect(repository.getImage(1)).rejects.toThrow('larger than 4 bytes');
    });
  });
});

function firstFixtureProduct(): Record<string, unknown> {
  if (!Array.isArray(productsFixture) || typeof productsFixture[0] !== 'object' || productsFixture[0] === null) {
    throw new Error('Fixture is not an array of products');
  }
  return { ...(productsFixture[0] as Record<string, unknown>) };
}
