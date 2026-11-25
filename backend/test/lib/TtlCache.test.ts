import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../../src/lib/TtlCache.js';
import { deferred } from '../support/fakeStore.js';

const TTL = 1_000;
const MAX_STALE = 10_000;
const BACKOFF = 500;

function setup(maxEntries = 10) {
  let time = 0;
  const cache = new TtlCache<string, string>({
    ttlMs: TTL,
    maxStaleAgeMs: MAX_STALE,
    retryBackoffMs: BACKOFF,
    maxEntries,
    now: () => time,
  });
  return {
    cache,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

/** A cache holding "v1", now expired (inside the stale window). */
async function expiredSetup() {
  const context = setup();
  await context.cache.get('k', async () => 'v1');
  context.advance(TTL);
  return context;
}

const fail = (message = 'upstream down') => () => Promise.reject(new Error(message));

describe('TtlCache: stale-while-revalidate (§5.6, D-011)', () => {
  it('serves a fresh entry without calling the loader again', async () => {
    const { cache, advance } = setup();
    const load = vi.fn().mockResolvedValue('v1');

    await cache.get('k', load);
    advance(TTL - 1);

    expect(await cache.get('k', load)).toEqual({ value: 'v1', stale: false, ageMs: TTL - 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('first load (no copy): waits for the loader', async () => {
    const { cache } = setup();
    expect(await cache.get('k', async () => 'v1')).toEqual({ value: 'v1', stale: false, ageMs: 0 });
  });

  it('first load failure is rethrown and not cached', async () => {
    const { cache } = setup();
    await expect(cache.get('k', fail('down'))).rejects.toThrow('down');

    const load = vi.fn().mockResolvedValue('v1');
    expect((await cache.get('k', load)).value).toBe('v1');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('expired copy: returned immediately, marked stale, without waiting for the loader', async () => {
    const { cache } = await expiredSetup();
    const upstream = deferred<string>(); // never settled before the assertion
    const load = vi.fn(() => upstream.promise);

    expect(await cache.get('k', load)).toEqual({ value: 'v1', stale: true, ageMs: TTL });
    expect(load).toHaveBeenCalledTimes(1);

    upstream.resolve('v2');
    await cache.whenIdle();
  });

  it('concurrent requests on an expired copy start exactly one background refresh', async () => {
    const { cache } = await expiredSetup();
    const upstream = deferred<string>();
    const load = vi.fn(() => upstream.promise);

    const results = await Promise.all([cache.get('k', load), cache.get('k', load), cache.get('k', load)]);
    expect(results.map((r) => r.value)).toEqual(['v1', 'v1', 'v1']);
    expect(load).toHaveBeenCalledTimes(1);

    upstream.resolve('v2');
    await cache.whenIdle();
  });

  it('a successful background refresh replaces the copy', async () => {
    const { cache } = await expiredSetup();
    await cache.get('k', async () => 'v2');
    await cache.whenIdle();

    const load = vi.fn();
    expect(await cache.get('k', load)).toEqual({ value: 'v2', stale: false, ageMs: 0 });
    expect(load).not.toHaveBeenCalled();
  });

  it('a failed background refresh keeps the old copy and reports the error once', async () => {
    const { cache } = await expiredSetup();
    const onError = vi.fn();
    const failure = new Error('upstream down');

    await cache.get('k', () => Promise.reject(failure), onError);
    await cache.whenIdle();
    const again = await cache.get('k', fail(), onError);
    await cache.whenIdle();

    expect(again).toEqual({ value: 'v1', stale: true, ageMs: TTL });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure, TTL);
  });

  describe('retry back-off after a failed background refresh', () => {
    async function afterFailedRefresh() {
      const context = await expiredSetup();
      await context.cache.get('k', fail());
      await context.cache.whenIdle();
      return context;
    }

    it('within the window: serves stale and starts no refresh', async () => {
      const { cache, advance } = await afterFailedRefresh();
      advance(BACKOFF - 1);
      const load = vi.fn().mockResolvedValue('v2');

      expect(await cache.get('k', load)).toMatchObject({ value: 'v1', stale: true });
      await cache.whenIdle();
      expect(load).not.toHaveBeenCalled();
    });

    it('after the window: starts one refresh', async () => {
      const { cache, advance } = await afterFailedRefresh();
      advance(BACKOFF);
      const load = vi.fn().mockResolvedValue('v2');

      expect(await cache.get('k', load)).toMatchObject({ value: 'v1', stale: true });
      await cache.whenIdle();
      expect(load).toHaveBeenCalledTimes(1);
      expect((await cache.get('k', load)).value).toBe('v2');
    });

    it('a second failure after the window starts a new window', async () => {
      const { cache, advance } = await afterFailedRefresh();
      advance(BACKOFF);
      await cache.get('k', fail());
      await cache.whenIdle();

      advance(BACKOFF - 1);
      const load = vi.fn().mockResolvedValue('v2');
      await cache.get('k', load);
      await cache.whenIdle();
      expect(load).not.toHaveBeenCalled();
    });
  });

  describe('24 h cap', () => {
    it('past the cap: the call waits for the loader and gets the new copy', async () => {
      const { cache, advance } = setup();
      await cache.get('k', async () => 'v1');
      advance(MAX_STALE + 1);

      expect(await cache.get('k', async () => 'v2')).toEqual({ value: 'v2', stale: false, ageMs: 0 });
    });

    it('past the cap: the call waits and rethrows when the loader fails, even inside a back-off window', async () => {
      let time = 0;
      const cache = new TtlCache<string, string>({
        ttlMs: 1_000,
        maxStaleAgeMs: 1_500,
        retryBackoffMs: 5_000, // the window outlasts the remaining stale allowance
        maxEntries: 1,
        now: () => time,
      });
      await cache.get('k', async () => 'v1');
      time = 1_000;
      await cache.get('k', fail());
      await cache.whenIdle();
      time = 1_600;

      const load = vi.fn().mockRejectedValue(new Error('still down'));
      await expect(cache.get('k', load)).rejects.toThrow('still down');
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  it('never turns a background failure into an unhandled rejection, even if the error handler throws', async () => {
    const { cache } = await expiredSetup();
    const throwingHandler = () => {
      throw new Error('handler bug');
    };

    await cache.get('k', fail(), throwingHandler);
    await expect(cache.whenIdle()).resolves.toBeUndefined();
    expect((await cache.get('k', fail())).value).toBe('v1');
  });

  it('tracks a loader that throws synchronously and recovers on the next call', async () => {
    const { cache } = setup();
    const syncThrow = (): Promise<string> => {
      throw new Error('sync boom');
    };
    await expect(cache.get('k', syncThrow)).rejects.toThrow('sync boom');
    expect((await cache.get('k', async () => 'v1')).value).toBe('v1');
  });

  it('first loads share one in-flight request', async () => {
    const { cache } = setup();
    const upstream = deferred<string>();
    const load = vi.fn(() => upstream.promise);

    const first = cache.get('k', load);
    const second = cache.get('k', load);
    upstream.resolve('v1');

    expect((await Promise.all([first, second])).map((r) => r.value)).toEqual(['v1', 'v1']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used entry beyond maxEntries', async () => {
    const { cache } = setup(2);
    await cache.get('a', async () => 'A');
    await cache.get('b', async () => 'B');
    await cache.get('a', async () => 'unused'); // touch "a" so "b" is the oldest
    await cache.get('c', async () => 'C');

    // "b" was evicted, so it loads again; "c" is still cached.
    const reloadB = vi.fn().mockResolvedValue('B2');
    expect((await cache.get('b', reloadB)).value).toBe('B2');
    expect(reloadB).toHaveBeenCalledTimes(1);
    expect((await cache.get('c', async () => 'unused')).value).toBe('C');
  });
});
