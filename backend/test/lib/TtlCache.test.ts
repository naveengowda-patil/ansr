import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../../src/lib/TtlCache.js';

const TTL = 1_000;
const MAX_STALE = 10_000;

function setup(maxEntries = 10) {
  let time = 0;
  const cache = new TtlCache<string, string>({ ttlMs: TTL, maxStaleAgeMs: MAX_STALE, maxEntries, now: () => time });
  return {
    cache,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

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
    });
  });

  it('rethrows when the only copy is older than the cap', async () => {
    const { cache, advance } = setup();
    await cache.get('k', async () => 'v1');
    advance(MAX_STALE + 1);

    await expect(cache.get('k', () => Promise.reject(new Error('upstream down')))).rejects.toThrow('upstream down');
  });

  it('rethrows when there is no copy, and does not cache the failure', async () => {
    const { cache } = setup();
    await expect(cache.get('k', () => Promise.reject(new Error('down')))).rejects.toThrow('down');

    expect(await cache.get('k', async () => 'v1')).toEqual({ value: 'v1', stale: false });
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
