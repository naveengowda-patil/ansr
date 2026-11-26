import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/errors.js';
import {
  BACKOFF_MS,
  createFakeStoreRepository as setup,
  deferred,
  imageResponse,
  MAX_STALE_MS,
  neverResolvesUntilAborted,
  PNG_BYTES,
  productsFixture,
  TTL_MS,
} from '../support/fakeStore.js';

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

    it('rejects the whole response when one product has an unexpected shape (D-028)', async () => {
      const [first, ...others] = productsFixture as Record<string, unknown>[];
      const { repository } = setup({ products: () => Response.json([{ ...first, rating: undefined }, ...others]) });
      await expect(repository.getAll()).rejects.toThrow('unexpected shape');
    });

    it('rejects a body that is not JSON', async () => {
      const { repository } = setup({ products: () => new Response('<html>', { status: 200 }) });
      await expect(repository.getAll()).rejects.toThrow('invalid JSON');
    });
  });

  describe('stale-while-revalidate, catalogue (D-011)', () => {
    /** Catalogue loaded at t=0, then upstream answers are controlled per call. */
    async function expiredCatalogue() {
      let next: () => Response | Promise<Response> = () => Response.json(productsFixture);
      const context = setup({ products: () => next() });
      const first = await context.repository.getAll();
      context.advance(TTL_MS);
      return {
        ...context,
        first,
        upstream: (respond: () => Response | Promise<Response>) => {
          next = respond;
        },
      };
    }

    it('fresh: serves from the cache without calling upstream', async () => {
      const { repository, catalogueCalls, advance } = setup();
      const first = await repository.getAll();
      advance(TTL_MS - 1);

      expect(await repository.getAll()).toBe(first);
      expect(catalogueCalls()).toHaveLength(1);
    });

    it('expired: returns the old copy without waiting for upstream', async () => {
      const { repository, first, upstream, settle } = await expiredCatalogue();
      const held = deferred<Response>(); // upstream hasn't answered when we assert
      upstream(() => held.promise);

      expect(await repository.getAll()).toBe(first);

      held.resolve(Response.json(productsFixture));
      await settle();
    });

    it('expired: concurrent requests start exactly one background refresh', async () => {
      const { repository, first, upstream, settle, catalogueCalls } = await expiredCatalogue();
      const held = deferred<Response>();
      upstream(() => held.promise);

      const results = await Promise.all([repository.getAll(), repository.getById(1), repository.listCategories()]);
      expect(results[0]).toBe(first);
      expect(catalogueCalls()).toHaveLength(2);

      held.resolve(Response.json(productsFixture));
      await settle();
      expect(catalogueCalls()).toHaveLength(2);
    });

    it('a successful refresh replaces the copy', async () => {
      const { repository, upstream, settle } = await expiredCatalogue();
      const [firstProduct, ...others] = productsFixture as Record<string, unknown>[];
      upstream(() => Response.json([{ ...firstProduct, title: 'New title' }, ...others]));

      await repository.getAll(); // old copy, refresh starts
      await settle();

      expect((await repository.getAll())[0]?.title).toBe('New title');
    });

    it('a failed refresh keeps serving the old copy and logs once', async () => {
      const { repository, first, upstream, settle, logger, catalogueCalls } = await expiredCatalogue();
      upstream(() => new Response('down', { status: 500 }));

      expect(await repository.getAll()).toBe(first);
      await settle();
      expect(await repository.getAll()).toBe(first);
      expect(await repository.getById(1)).toEqual(first[0]);
      await settle();

      expect(catalogueCalls()).toHaveLength(2);
      expect(logger.withMessage('catalogue.refresh_failed')).toEqual([
        {
          level: 'warn',
          message: 'catalogue.refresh_failed',
          context: { ageSeconds: TTL_MS / 1000, reason: 'Product source responded with HTTP 500' },
        },
      ]);
    });

    it('respects the back-off: no refresh inside the window, one after it', async () => {
      const { repository, upstream, settle, advance, catalogueCalls } = await expiredCatalogue();
      upstream(() => new Response('down', { status: 500 }));
      await repository.getAll();
      await settle();
      expect(catalogueCalls()).toHaveLength(2);

      advance(BACKOFF_MS - 1);
      await repository.getAll();
      await settle();
      expect(catalogueCalls()).toHaveLength(2);

      advance(1);
      await repository.getAll();
      await settle();
      expect(catalogueCalls()).toHaveLength(3);
    });

    it('past the 24 h cap: the request waits for upstream and fails with UpstreamError', async () => {
      const { repository, upstream, advance, catalogueCalls } = await expiredCatalogue();
      upstream(() => new Response('down', { status: 500 }));
      advance(MAX_STALE_MS); // copy is now TTL + 24 h old

      await expect(repository.getAll()).rejects.toBeInstanceOf(UpstreamError);
      expect(catalogueCalls()).toHaveLength(2);
    });

    it('past the 24 h cap: the request waits and gets the new copy when upstream is back', async () => {
      const { repository, first, advance } = await expiredCatalogue();
      advance(MAX_STALE_MS);

      const refreshed = await repository.getAll();
      expect(refreshed).not.toBe(first);
      expect(refreshed).toEqual(first);
    });

    it('no copy + failure: throws UpstreamError', async () => {
      const { repository } = setup({ products: () => new Response('down', { status: 500 }) });
      await expect(repository.getAll()).rejects.toBeInstanceOf(UpstreamError);
    });
  });

  describe('stale-while-revalidate, images (D-011)', () => {
    async function expiredImage() {
      let next: () => Response | Promise<Response> = () => imageResponse('image/png');
      const context = setup({ image: () => next() });
      await context.repository.getImage(1);
      context.advance(TTL_MS);
      await context.repository.getAll(); // refresh the catalogue too so only the image is under test
      await context.settle();
      return {
        ...context,
        upstream: (respond: () => Response | Promise<Response>) => {
          next = respond;
        },
      };
    }

    it('expired: returns the old image without waiting, with one background refresh', async () => {
      const { repository, upstream, settle, imageCalls } = await expiredImage();
      const held = deferred<Response>();
      upstream(() => held.promise);

      const results = await Promise.all([repository.getImage(1), repository.getImage(1)]);
      expect(results).toEqual([
        { contentType: 'image/png', data: PNG_BYTES },
        { contentType: 'image/png', data: PNG_BYTES },
      ]);
      expect(imageCalls()).toHaveLength(2);

      held.resolve(imageResponse('image/jpeg'));
      await settle();
      expect((await repository.getImage(1))?.contentType).toBe('image/jpeg');
    });

    it('a failed refresh keeps the old image, logs once and backs off', async () => {
      const { repository, upstream, settle, advance, logger, imageCalls } = await expiredImage();
      upstream(() => new Response('down', { status: 500 }));

      await repository.getImage(1);
      await settle();
      advance(BACKOFF_MS - 1);
      expect(await repository.getImage(1)).toEqual({ contentType: 'image/png', data: PNG_BYTES });
      await settle();

      expect(imageCalls()).toHaveLength(2);
      expect(logger.withMessage('image.refresh_failed')).toHaveLength(1);
      expect(logger.withMessage('image.refresh_failed')[0]?.context).toMatchObject({ productId: 1 });
    });
  });

  describe('debug events (§5.11)', () => {
    it('upstream.request: path, status and duration from the injected clock', async () => {
      let advanceBy: (ms: number) => void = () => {};
      const context = setup({
        products: () => {
          advanceBy(25);
          return Response.json(productsFixture);
        },
      });
      advanceBy = context.advance;
      await context.repository.getAll();

      expect(context.logger.withMessage('upstream.request')).toEqual([
        { level: 'debug', message: 'upstream.request', context: { path: '/products', status: 200, durationMs: 25 } },
      ]);
    });

    it.each([
      ['an HTTP error', () => new Response('down', { status: 503 }), 503],
      ['a network error', () => Promise.reject(new TypeError('fetch failed')), 'network_error'],
    ] as const)('upstream.request on %s reports status %s', async (_label, route, status) => {
      const { repository, logger } = setup({ products: route });
      await expect(repository.getAll()).rejects.toBeInstanceOf(UpstreamError);
      expect(logger.withMessage('upstream.request')[0]?.context).toMatchObject({ path: '/products', status });
    });

    it('upstream.request on a timeout reports status "timeout"', async () => {
      const { repository, logger } = setup({ products: neverResolvesUntilAborted, timeoutMs: 20 });
      await expect(repository.getAll()).rejects.toBeInstanceOf(UpstreamError);
      expect(logger.withMessage('upstream.request')[0]?.context).toMatchObject({ status: 'timeout' });
    });

    it('image.fetched: productId, bytes, contentType and duration', async () => {
      let advanceBy: (ms: number) => void = () => {};
      const context = setup({
        image: () => {
          advanceBy(15);
          return imageResponse('image/png');
        },
      });
      advanceBy = context.advance;
      await context.repository.getImage(1);

      expect(context.logger.withMessage('image.fetched')).toEqual([
        {
          level: 'debug',
          message: 'image.fetched',
          context: { productId: 1, bytes: PNG_BYTES.byteLength, contentType: 'image/png', durationMs: 15 },
        },
      ]);
    });

    it('cache events name the catalogue and image caches', async () => {
      const { repository, logger } = setup();
      await repository.getImage(1);
      await repository.getImage(1);

      const cacheEvents = logger.entries
        .filter((entry) => entry.message.startsWith('cache.'))
        .map((entry) => `${entry.message}:${String(entry.context.cache)}:${String(entry.context.key)}`);
      expect(cacheEvents).toEqual([
        'cache.miss:catalogue:catalogue',
        'cache.miss:image:1',
        'cache.hit:catalogue:catalogue',
        'cache.hit:image:1',
      ]);
    });
  });

  describe('image proxy guards (D-001)', () => {
    it('returns the image bytes and content type', async () => {
      const { repository, imageCalls } = setup();
      const image = await repository.getImage(1);

      expect(image).toEqual({ contentType: 'image/png', data: PNG_BYTES });
      const [url, init] = imageCalls()[0] ?? [];
      expect(url?.toString()).toBe('https://fakestoreapi.com/img/81fPKd-2AYL._AC_SL1500_t.png');
      expect(init?.redirect).toBe('error');
    });

    it('returns undefined for an unknown product without fetching', async () => {
      const { repository, imageCalls } = setup();
      expect(await repository.getImage(999)).toBeUndefined();
      expect(imageCalls()).toHaveLength(0);
    });

    it('host not in the allowlist: rejected without making a request', async () => {
      const { repository, imageCalls } = setup({ imageHostAllowlist: ['images.example.test'] });
      await expect(repository.getImage(1)).rejects.toThrow('not in the allowlist');
      expect(imageCalls()).toHaveLength(0);
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

    it.each([
      ['image/jpeg', 'image/jpeg'],
      ['image/png', 'image/png'],
      ['image/webp', 'image/webp'],
      ['image/gif', 'image/gif'],
      ['IMAGE/JPEG; charset=binary', 'image/jpeg'],
    ])('allowed type %s: passed through as %s', async (header, normalised) => {
      const { repository } = setup({ image: () => imageResponse(header) });
      expect((await repository.getImage(1))?.contentType).toBe(normalised);
    });

    it.each(['image/svg+xml', 'image/x-icon', 'text/html', ''])('disallowed type "%s": rejected', async (type) => {
      const { repository } = setup({ image: () => imageResponse(type, '<svg onload="alert(1)"/>') });
      await expect(repository.getImage(1)).rejects.toThrow('disallowed content type');
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
