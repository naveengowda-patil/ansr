import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../../src/lib/TtlCache.js';

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

const fail = (message = 'upstream down') => () => Promise.reject(new Error(message));

describe('TtlCache (§5.6, D-011)', () => {
  it('serves a fresh entry without calling the loader again', async () => {
    const { cache, advance } = setup();
    const load = vi.fn().mockResolvedValue('v1');

    await cache.get('k', load);
    advance(TTL - 1);
    const result = await cache.get('k', load);

    expect(result).toEqual({ value: 'v1', stale: false });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL and replaces the copy', async () => {
    const { cache, advance } = setup();
    await cache.get('k', async () => 'v1');
    advance(TTL);

    expect(await cache.get('k', async () => 'v2')).toEqual({ value: 'v2', stale: false });
  });

  it('serves the stale copy when the refetch fails within the cap', async () => {
    const { cache, advance } = setup();
    await cache.get('k', async () => 'v1');
    advance(MAX_STALE);
    const failure = new Error('upstream down');

    expect(await cache.get('k', () => Promise.reject(failure))).toEqual({
      value: 'v1',
      stale: true,
      ageMs: MAX_STALE,
      error: failure,
      refreshAttempted: true,
    });
  });

  it('rethrows when the only copy is older than the cap', async () => {
    const { cache, advance } = setup();
    await cache.get('k', async () => 'v1');
    advance(MAX_STALE + 1);

    await expect(cache.get('k', fail())).rejects.toThrow('upstream down');
  });

  it('rethrows when there is no copy, and does not cache the failure', async () => {
    const { cache } = setup();
    await expect(cache.get('k', fail('down'))).rejects.toThrow('down');

    expect(await cache.get('k', async () => 'v1')).toEqual({ value: 'v1', stale: false });
  });

  describe('retry back-off', () => {
    async function afterFailedRefresh() {
      const context = setup();
      await context.cache.get('k', async () => 'v1');
      context.advance(TTL);
      const failure = await context.cache.get('k', fail());
      return { ...context, failure };
    }

    it('within the window: serves stale without calling the loader', async () => {
      const { cache, advance, failure } = await afterFailedRefresh();
      advance(BACKOFF - 1);
      const load = vi.fn().mockResolvedValue('v2');

      const result = await cache.get('k', load);

      expect(load).not.toHaveBeenCalled();
      expect(result).toMatchObject({ value: 'v1', stale: true, refreshAttempted: false, ageMs: TTL + BACKOFF - 1 });
      expect(result.stale && result.error).toBe(failure.stale && failure.error);
    });

    it('after the window: calls the loader again', async () => {
      const { cache, advance } = await afterFailedRefresh();
      advance(BACKOFF);
      const load = vi.fn().mockResolvedValue('v2');

      expect(await cache.get('k', load)).toEqual({ value: 'v2', stale: false });
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('after the window: a second failure starts a new window', async () => {
      const { cache, advance } = await afterFailedRefresh();
      advance(BACKOFF);
      expect(await cache.get('k', fail())).toMatchObject({ stale: true, refreshAttempted: true });

      const load = vi.fn().mockResolvedValue('v2');
      advance(BACKOFF - 1);
      expect(await cache.get('k', load)).toMatchObject({ value: 'v1', stale: true, refreshAttempted: false });
      expect(load).not.toHaveBeenCalled();
    });

    it('stops serving stale inside the window once the copy passes the cap', async () => {
      let time = 0;
      // Window (5 s) outlasts the remaining stale allowance (1.5 s cap).
      const cache = new TtlCache<string, string>({
        ttlMs: 1_000,
        maxStaleAgeMs: 1_500,
        retryBackoffMs: 5_000,
        maxEntries: 1,
        now: () => time,
      });
      await cache.get('k', async () => 'v1');
      time = 1_000;
      await cache.get('k', fail());
      time = 1_600; // inside the window, but the copy is 1.6 s old

      const load = vi.fn().mockRejectedValue(new Error('still down'));
      await expect(cache.get('k', load)).rejects.toThrow('still down');
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('is cleared by a successful refresh', async () => {
      const { cache, advance } = await afterFailedRefresh();
      advance(BACKOFF);
      await cache.get('k', async () => 'v2');
      advance(TTL);

      const load = vi.fn().mockResolvedValue('v3');
      expect(await cache.get('k', load)).toEqual({ value: 'v3', stale: false });
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const { cache } = setup();
    let resolve: (value: string) => void = () => {};
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));

    const first = cache.get('k', load);
    const second = cache.get('k', load);
    resolve('v1');

    expect(await Promise.all([first, second])).toEqual([
      { value: 'v1', stale: false },
      { value: 'v1', stale: false },
    ]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used entry beyond maxEntries', async () => {
    const { cache } = setup(2);
    await cache.get('a', async () => 'A');
    await cache.get('b', async () => 'B');
    await cache.get('a', async () => 'unused'); // touch "a" so "b" is the oldest
    await cache.get('c', async () => 'C');

    // "b" was evicted, so it reloads; "c" is still cached.
    const reloadB = vi.fn().mockResolvedValue('B2');
    expect((await cache.get('b', reloadB)).value).toBe('B2');
    expect(reloadB).toHaveBeenCalledTimes(1);
    expect((await cache.get('c', async () => 'unused')).value).toBe('C');
  });
});
