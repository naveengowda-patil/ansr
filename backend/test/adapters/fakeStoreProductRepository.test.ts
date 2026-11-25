import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/errors.js';
import {
  BACKOFF_MS,
  createFakeStoreRepository as setup,
  imageResponse,
  MAX_STALE_MS,
  neverResolvesUntilAborted,
  PNG_BYTES,
  productsFixture,
  TTL_MS,
} from '../support/fakeStore.js';

const down = () => new Response('down', { status: 500 });

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
      const [first] = productsFixture as Record<string, unknown>[];
      const { repository, fetch, advance } = setup({ products: () => Response.json([{ ...first, title }]) });
      await repository.getAll();
      title = 'New title';
      advance(TTL_MS);

      expect((await repository.getAll())[0]?.title).toBe('New title');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('expired + refetch fails: serves the stale copy and logs a warning', async () => {
      let up = true;
      const { repository, logger, advance } = setup({
        products: () => (up ? Response.json(productsFixture) : down()),
      });
      const first = await repository.getAll();
      up = false;
      advance(TTL_MS + 60_000);

      expect(await repository.getAll()).toBe(first);
      expect(logger.withMessage('catalogue.stale_served')).toEqual([
        {
          level: 'warn',
          message: 'catalogue.stale_served',
          context: { ageSeconds: 360, reason: 'Product source responded with HTTP 500' },
        },
      ]);
    });

    it('stale copy older than the 24 h cap + refetch fails: throws', async () => {
      let up = true;
      const { repository, advance } = setup({ products: () => (up ? Response.json(productsFixture) : down()) });
      await repository.getAll();
      up = false;
      advance(MAX_STALE_MS + 1);

      await expect(repository.getAll()).rejects.toBeInstanceOf(UpstreamError);
    });

    it('no copy + failure: throws UpstreamError', async () => {
      const { repository } = setup({ products: down });
      await expect(repository.getAll()).rejects.toBeInstanceOf(UpstreamError);
    });
  });

  describe('retry back-off after a failed refresh (D-011)', () => {
    async function catalogueOutage() {
      let up = true;
      const context = setup({ products: () => (up ? Response.json(productsFixture) : down()) });
      const first = await context.repository.getAll();
      up = false;
      context.advance(TTL_MS);
      await context.repository.getAll(); // failed refresh: stale served, back-off starts
      return {
        ...context,
        first,
        recover: () => {
          up = true;
        },
      };
    }

    it('within the window: serves stale with no upstream call and no extra warning', async () => {
      const { repository, catalogueCalls, logger, advance, first } = await catalogueOutage();
      expect(catalogueCalls()).toHaveLength(2);

      advance(BACKOFF_MS - 1);
      expect(await repository.getAll()).toBe(first);
      expect(await repository.getById(1)).toEqual(first[0]);

      expect(catalogueCalls()).toHaveLength(2);
      expect(logger.withMessage('catalogue.stale_served')).toHaveLength(1);
    });

    it('after the window: retries upstream', async () => {
      const { repository, catalogueCalls, logger, advance, first } = await catalogueOutage();

      advance(BACKOFF_MS);
      expect(await repository.getAll()).toBe(first);

      expect(catalogueCalls()).toHaveLength(3);
      expect(logger.withMessage('catalogue.stale_served')).toHaveLength(2);
    });

    it('after the window: a successful retry serves fresh data', async () => {
      const { repository, catalogueCalls, advance, first, recover } = await catalogueOutage();
      recover();
      advance(BACKOFF_MS);

      const refreshed = await repository.getAll();
      expect(refreshed).not.toBe(first);
      expect(refreshed).toEqual(first);
      expect(catalogueCalls()).toHaveLength(3);
    });

    it('images: within the window no image request is made; after it, one is', async () => {
      let up = true;
      const { repository, imageCalls, advance, logger } = setup({
        image: () => (up ? imageResponse('image/png') : down()),
      });
      await repository.getAll();
      await repository.getImage(1);
      up = false; // only images fail; the catalogue stays reachable and simply refreshes
      advance(TTL_MS);
      expect(await repository.getImage(1)).toEqual({ contentType: 'image/png', data: PNG_BYTES });
      expect(imageCalls()).toHaveLength(2);

      advance(BACKOFF_MS - 1);
      expect(await repository.getImage(1)).toEqual({ contentType: 'image/png', data: PNG_BYTES });
      expect(imageCalls()).toHaveLength(2);

      advance(1);
      await repository.getImage(1);
      expect(imageCalls()).toHaveLength(3);
      expect(logger.withMessage('image.stale_served')).toHaveLength(2);
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
