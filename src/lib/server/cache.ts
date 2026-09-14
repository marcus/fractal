/**
 * Bounded caches for server-side work that is expensive to repeat and cheap to key.
 *
 * Caching is a server concern, never a core one: the model parser, the projection and the
 * layout engines stay pure and are always safe to call directly. Keeping the store behind this
 * small interface means a different eviction policy — or none — is a local change, and tests
 * can clear it or read its counters without reaching into module state.
 *
 * Each cache bounds entries and estimated bytes with LRU eviction, and entries carry tags so
 * one project's edit can invalidate exactly its dependents. A shared pool bounds the retained
 * total across caches and evicts low-priority caches first, so large composed results and
 * layouts give way before parsed models (small semantic records are always cheapest to keep).
 */

export interface CacheStats {
  hits: number;
  misses: number;
  /** Entries dropped by an entry or byte bound (explicit deletes and invalidations excluded). */
  evictions: number;
}

/** A point-in-time copy of a cache's counters, entry count and estimated bytes. */
export interface CacheSnapshot extends CacheStats {
  entries: number;
  bytes: number;
  /**
   * Alias for `entries`: the long-standing name existing readers (including the bench
   * harness, which this slice may not edit) use for the entry count.
   */
  size: number;
}

export interface Cache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T, options?: { tags?: readonly string[] }): void;
  /** Union tags into an existing entry; a no-op when the key is absent. */
  tag(key: string, tags: readonly string[]): void;
  /** Drop the single least-recently-used entry; false when already empty. */
  evictOldest(): boolean;
  delete(key: string): void;
  /** Delete every entry carrying any of the tags; returns the entries removed. */
  invalidateTags(tags: readonly string[]): number;
  clear(): void;
  readonly size: number;
  readonly bytes: number;
  /** Hits, misses and evictions since the last clear. Exposed so tests can prove work skipped. */
  readonly stats: CacheStats;
  snapshot(): CacheSnapshot;
}

export interface CacheOptions<T> {
  /** Estimated retained bytes; entry and byte bounds evict least-recently-used first. */
  maxBytes?: number;
  /** Estimated bytes of a stored value; defaults to zero (the entry bound alone applies). */
  sizeOf?: (value: T) => number;
  /**
   * When the stored value is a promise, re-account with this once it settles. Until then the
   * entry carries `inFlightBytes`, so in-flight responses are inside the byte bound too.
   */
  settleSizeOf?: (settled: Awaited<T>) => number;
  /**
   * Nominal bytes for an unsettled promise. A placeholder, not a measurement; the settled
   * size replaces it. Defaults to zero.
   */
  inFlightBytes?: number;
  /** Shared total bound; when set, every write re-enforces it (see `createCachePool`). */
  pool?: CachePool;
  /** Lower priorities are evicted first when the shared pool is over budget. */
  priority?: number;
}

export interface CachePool {
  readonly maxBytes: number;
  readonly bytes: number;
  /** Register a member cache; lower priorities are evicted first when over budget. */
  register<T>(priority: number, cache: Cache<T>): void;
  /** Evict lowest-priority least-recently-used entries until within budget. */
  enforce(): void;
  /** Invalidate tagged entries in every member cache; returns the entries removed. */
  invalidateTags(tags: readonly string[]): number;
}

interface PoolMember {
  priority: number;
  cache: Cache<unknown>;
}

/**
 * A shared byte bound across caches. Members are evicted lowest priority first (ties break
 * toward the cache holding the most bytes, which frees budget fastest); within a cache,
 * eviction stays least-recently-used. Register composed results below layouts below parsed
 * models so large artifacts give way before the parses everything else rebuilds from.
 */
export function createCachePool(maxBytes: number): CachePool {
  const members: PoolMember[] = [];
  const pool: CachePool = {
    maxBytes,
    register<T>(priority: number, cache: Cache<T>): void {
      members.push({ priority, cache });
    },
    get bytes() {
      return members.reduce((total, member) => total + member.cache.bytes, 0);
    },
    enforce() {
      for (;;) {
        if (pool.bytes <= maxBytes) return;
        const candidates = members
          .filter((member) => member.cache.size > 0)
          .sort((a, b) => a.priority - b.priority || b.cache.bytes - a.cache.bytes);
        if (candidates.length === 0) return;
        if (!candidates[0].cache.evictOldest()) return;
      }
    },
    invalidateTags(tags) {
      return members.reduce((total, member) => total + member.cache.invalidateTags(tags), 0);
    }
  };
  return pool;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

/** Least-recently-used by insertion order: a hit re-inserts, so the oldest key is evicted first. */
export function createCache<T>(limit: number, options: CacheOptions<T> = {}): Cache<T> {
  interface Entry {
    value: T;
    bytes: number;
    tags: Set<string>;
  }
  const entries = new Map<string, Entry>();
  const tagIndex = new Map<string, Set<string>>();
  const stats: CacheStats = { hits: 0, misses: 0, evictions: 0 };
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const sizeOf = options.sizeOf ?? ((): number => 0);
  let bytes = 0;

  function untag(key: string, entry: Entry): void {
    for (const tag of entry.tags) {
      const keys = tagIndex.get(tag);
      if (!keys) continue;
      keys.delete(key);
      if (keys.size === 0) tagIndex.delete(tag);
    }
  }

  function remove(key: string, entry: Entry): void {
    entries.delete(key);
    bytes -= entry.bytes;
    untag(key, entry);
  }

  function evictOldestEntry(): boolean {
    const oldest = entries.keys().next().value as string | undefined;
    if (oldest === undefined) return false;
    const entry = entries.get(oldest);
    if (!entry) return false;
    remove(oldest, entry);
    stats.evictions += 1;
    return true;
  }

  const cache: Cache<T> = {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) {
        stats.misses += 1;
        return undefined;
      }
      stats.hits += 1;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value, setOptions = {}) {
      const previous = entries.get(key);
      if (previous) remove(key, previous);
      let entryBytes = sizeOf(value);
      if (isThenable(value) && options.settleSizeOf !== undefined) {
        entryBytes = options.inFlightBytes ?? 0;
        const seen = value;
        const settled = options.settleSizeOf;
        Promise.resolve(seen).then(
          (result) => {
            const current = entries.get(key);
            if (current && current.value === seen) {
              bytes -= current.bytes;
              current.bytes = settled(result as Awaited<T>);
              bytes += current.bytes;
              while (bytes > maxBytes) {
                if (!evictOldestEntry()) break;
              }
              options.pool?.enforce();
            }
          },
          () => {
            // The caller deletes a rejected parse (a failed model is never remembered);
            // the rejection itself carries no accounting to repair here.
          }
        );
      }
      const entry: Entry = { value, bytes: entryBytes, tags: new Set(setOptions.tags ?? []) };
      entries.set(key, entry);
      bytes += entryBytes;
      for (const tag of entry.tags) {
        let keys = tagIndex.get(tag);
        if (!keys) {
          keys = new Set();
          tagIndex.set(tag, keys);
        }
        keys.add(key);
      }
      while (entries.size > limit || bytes > maxBytes) {
        if (!evictOldestEntry()) break;
      }
      options.pool?.enforce();
    },
    tag(key, tags) {
      const entry = entries.get(key);
      if (!entry) return;
      for (const tag of tags) {
        if (entry.tags.has(tag)) continue;
        entry.tags.add(tag);
        let keys = tagIndex.get(tag);
        if (!keys) {
          keys = new Set();
          tagIndex.set(tag, keys);
        }
        keys.add(key);
      }
    },
    evictOldest() {
      return evictOldestEntry();
    },
    delete(key) {
      const entry = entries.get(key);
      if (entry) remove(key, entry);
    },
    invalidateTags(tags) {
      const keys = new Set<string>();
      for (const tag of tags) {
        const tagged = tagIndex.get(tag);
        if (tagged) for (const key of tagged) keys.add(key);
      }
      for (const key of keys) {
        const entry = entries.get(key);
        if (entry) remove(key, entry);
      }
      return keys.size;
    },
    clear() {
      entries.clear();
      tagIndex.clear();
      bytes = 0;
      stats.hits = 0;
      stats.misses = 0;
      stats.evictions = 0;
    },
    get size() {
      return entries.size;
    },
    get bytes() {
      return bytes;
    },
    stats,
    snapshot() {
      return {
        hits: stats.hits,
        misses: stats.misses,
        evictions: stats.evictions,
        entries: entries.size,
        bytes,
        size: entries.size
      };
    }
  };
  if (options.pool) options.pool.register(options.priority ?? 0, cache);
  return cache;
}

/**
 * The server-wide retained-bytes bound for parsed models, local layouts and composed results.
 * Composed results evict first, then layouts, then parsed models. The bound matches the
 * `cacheBytes` admission limit so a composition that fits admission cannot itself overflow
 * the retained caches.
 */
export const serverCachePool: CachePool = createCachePool(128 * 1024 * 1024);
