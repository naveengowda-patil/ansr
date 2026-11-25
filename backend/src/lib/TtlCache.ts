/**
 * Keyed TTL cache with single-flight refetch, a capped stale fallback and a retry
 * back-off (blueprint §5.6, D-011).
 *
 * - Fresh entry (age < ttl): returned without calling the loader.
 * - Missing or expired entry: the loader runs once per key, shared by concurrent callers.
 * - Loader fails and the last good copy is at most `maxStaleAgeMs` old: that copy is
 *   returned, marked stale (`refreshAttempted: true`), and a back-off window starts.
 * - Inside the back-off window: the stale copy is returned at once without calling the
 *   loader (`refreshAttempted: false`). The first call after the window retries.
 * - Loader fails otherwise: the error is rethrown. Failures are never cached and, with
 *   nothing to serve, there is no back-off.
 * - At most `maxEntries` entries; the least recently used one is evicted.
 */
export interface TtlCacheOptions {
  readonly ttlMs: number;
  readonly maxStaleAgeMs: number;
  /** After a failed refresh that served a stale copy, don't call the loader again for this long. */
  readonly retryBackoffMs: number;
  readonly maxEntries: number;
  /** Current time in milliseconds. */
  readonly now: () => number;
}

export type CacheResult<V> =
  | { readonly value: V; readonly stale: false }
  | {
      readonly value: V;
      readonly stale: true;
      readonly ageMs: number;
      /** The error from the failed refresh that started the stale period. */
      readonly error: unknown;
      /** True when this call tried the loader and it failed; false inside the back-off window. */
      readonly refreshAttempted: boolean;
    };

interface Entry<V> {
  readonly value: V;
  readonly storedAt: number;
}

interface Backoff {
  readonly retryAfter: number;
  readonly error: unknown;
}

export class TtlCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();
  private readonly backoffs = new Map<K, Backoff>();
  private readonly inFlight = new Map<K, Promise<CacheResult<V>>>();

  constructor(private readonly options: TtlCacheOptions) {
    if (options.maxEntries < 1) throw new RangeError('maxEntries must be at least 1');
  }

  get(key: K, load: () => Promise<V>): Promise<CacheResult<V>> {
    const now = this.options.now();
    const entry = this.entries.get(key);
    if (entry && now - entry.storedAt < this.options.ttlMs) {
      this.touch(key, entry);
      return Promise.resolve({ value: entry.value, stale: false });
    }

    const backoff = this.backoffs.get(key);
    if (entry && backoff && now < backoff.retryAfter) {
      const ageMs = now - entry.storedAt;
      if (ageMs <= this.options.maxStaleAgeMs) {
        return Promise.resolve({ value: entry.value, stale: true, ageMs, error: backoff.error, refreshAttempted: false });
      }
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
      const now = this.options.now();
      const entry = this.entries.get(key);
      if (entry) {
        const ageMs = now - entry.storedAt;
        if (ageMs <= this.options.maxStaleAgeMs) {
          this.backoffs.set(key, { retryAfter: now + this.options.retryBackoffMs, error });
          return { value: entry.value, stale: true, ageMs, error, refreshAttempted: true };
        }
        this.entries.delete(key);
      }
      this.backoffs.delete(key);
      throw error;
    }
  }

  private store(key: K, value: V): void {
    this.entries.delete(key);
    this.backoffs.delete(key);
    this.entries.set(key, { value, storedAt: this.options.now() });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      this.backoffs.delete(oldest.value);
    }
  }

  private touch(key: K, entry: Entry<V>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}
