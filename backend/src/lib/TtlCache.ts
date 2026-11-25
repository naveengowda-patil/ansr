/**
 * Keyed in-memory cache with stale-while-revalidate, retry back-off and a stale cap
 * (blueprint §5.6, D-011).
 *
 * | Copy's age                    | Caller gets                         | Loader                          |
 * |-------------------------------|-------------------------------------|---------------------------------|
 * | no copy                       | waits for the load                  | foreground; errors rethrown     |
 * | < ttl                         | the copy (fresh)                    | none                            |
 * | ttl ≤ age ≤ maxStaleAge       | the copy at once (stale)            | one background refresh, unless  |
 * |                               |                                     | one is running or backing off   |
 * | > maxStaleAge                 | waits for a refresh                 | foreground; errors rethrown     |
 *
 * - One load per key at a time, shared by foreground and background callers.
 * - A failed background refresh calls `onBackgroundError` once, keeps the old copy and
 *   starts a back-off of `retryBackoffMs` during which no new refresh starts.
 * - Background errors are always caught; they never become unhandled rejections.
 * - Failures are never cached. At most `maxEntries` keys; the least recently used is evicted.
 */
export interface TtlCacheOptions {
  readonly ttlMs: number;
  readonly maxStaleAgeMs: number;
  /** After a failed background refresh, don't start another for this long. */
  readonly retryBackoffMs: number;
  readonly maxEntries: number;
  /** Current time in milliseconds. */
  readonly now: () => number;
}

export interface CacheResult<V> {
  readonly value: V;
  /** True when the copy is past the TTL (a background refresh may be running). */
  readonly stale: boolean;
  readonly ageMs: number;
}

/** Called when a background refresh fails, with the error and the age of the copy still served. */
export type BackgroundErrorHandler = (error: unknown, staleAgeMs: number) => void;

interface Entry<V> {
  readonly value: V;
  readonly storedAt: number;
}

export class TtlCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();
  /** Per key: time before which no background refresh may start. */
  private readonly retryAfter = new Map<K, number>();
  private readonly inFlight = new Map<K, Promise<V>>();
  private readonly background = new Set<Promise<void>>();

  constructor(private readonly options: TtlCacheOptions) {
    if (options.maxEntries < 1) throw new RangeError('maxEntries must be at least 1');
  }

  async get(key: K, load: () => Promise<V>, onBackgroundError?: BackgroundErrorHandler): Promise<CacheResult<V>> {
    const now = this.options.now();
    const entry = this.entries.get(key);
    if (entry) {
      const ageMs = now - entry.storedAt;
      if (ageMs < this.options.ttlMs) {
        this.touch(key, entry);
        return { value: entry.value, stale: false, ageMs };
      }
      if (ageMs <= this.options.maxStaleAgeMs) {
        this.touch(key, entry);
        this.revalidateInBackground(key, load, onBackgroundError, now);
        return { value: entry.value, stale: true, ageMs };
      }
    }
    const value = await this.load(key, load);
    return { value, stale: false, ageMs: 0 };
  }

  /** Resolves once every background refresh started so far (and any they trigger) has settled. */
  async whenIdle(): Promise<void> {
    while (this.background.size > 0) {
      await Promise.all(this.background);
    }
  }

  private revalidateInBackground(
    key: K,
    load: () => Promise<V>,
    onError: BackgroundErrorHandler | undefined,
    now: number,
  ): void {
    if (this.inFlight.has(key)) return;
    const retryAfter = this.retryAfter.get(key);
    if (retryAfter !== undefined && now < retryAfter) return;

    const settled = this.load(key, load).then(
      () => undefined,
      (error: unknown) => {
        const failedAt = this.options.now();
        this.retryAfter.set(key, failedAt + this.options.retryBackoffMs);
        const entry = this.entries.get(key);
        try {
          onError?.(error, entry ? failedAt - entry.storedAt : 0);
        } catch {
          // A failing error handler must never turn into an unhandled rejection.
        }
      },
    );
    this.background.add(settled);
    void settled.then(() => this.background.delete(settled));
  }

  /** Single-flight load: concurrent callers (foreground or background) share one promise. */
  private load(key: K, load: () => Promise<V>): Promise<V> {
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    // `then(load)` defers the call, so even a loader that throws synchronously is tracked first.
    const promise: Promise<V> = Promise.resolve()
      .then(load)
      .then((value) => {
        this.store(key, value);
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  private store(key: K, value: V): void {
    this.entries.delete(key);
    this.retryAfter.delete(key);
    this.entries.set(key, { value, storedAt: this.options.now() });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      this.retryAfter.delete(oldest.value);
    }
  }

  private touch(key: K, entry: Entry<V>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}
