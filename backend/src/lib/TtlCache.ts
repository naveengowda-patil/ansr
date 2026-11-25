/**
 * Keyed TTL cache with single-flight refetch and a capped stale fallback
 * (blueprint §5.6, D-011).
 *
 * - Fresh entry (age < ttl): returned without calling the loader.
 * - Missing or expired entry: the loader runs once per key, shared by concurrent callers.
 * - Loader fails and the last good copy is at most `maxStaleAgeMs` old: that copy is
 *   returned, marked stale, with its age and the error.
 * - Loader fails otherwise: the error is rethrown. Failures are never cached.
 * - At most `maxEntries` entries; the least recently used one is evicted.
 */
export interface TtlCacheOptions {
  readonly ttlMs: number;
  readonly maxStaleAgeMs: number;
  readonly maxEntries: number;
  /** Current time in milliseconds. */
  readonly now: () => number;
}

export type CacheResult<V> =
  | { readonly value: V; readonly stale: false }
  | { readonly value: V; readonly stale: true; readonly ageMs: number; readonly error: unknown };

interface Entry<V> {
  readonly value: V;
  readonly storedAt: number;
}

export class TtlCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();
  private readonly inFlight = new Map<K, Promise<CacheResult<V>>>();

  constructor(private readonly options: TtlCacheOptions) {
    if (options.maxEntries < 1) throw new RangeError('maxEntries must be at least 1');
  }

  get(key: K, load: () => Promise<V>): Promise<CacheResult<V>> {
    const entry = this.entries.get(key);
    if (entry && this.options.now() - entry.storedAt < this.options.ttlMs) {
      this.touch(key, entry);
      return Promise.resolve({ value: entry.value, stale: false });
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const refresh = this.refresh(key, load).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, refresh);
    return refresh;
  }

  private async refresh(key: K, load: () => Promise<V>): Promise<CacheResult<V>> {
    try {
      const value = await load();
      this.store(key, value);
      return { value, stale: false };
    } catch (error) {
      const entry = this.entries.get(key);
      if (entry) {
        const ageMs = this.options.now() - entry.storedAt;
        if (ageMs <= this.options.maxStaleAgeMs) {
          return { value: entry.value, stale: true, ageMs, error };
        }
        this.entries.delete(key);
      }
      throw error;
    }
  }

  private store(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: this.options.now() });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  private touch(key: K, entry: Entry<V>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}
