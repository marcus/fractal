/**
 * A minimal bounded cache for server-side work that is expensive to repeat and cheap to key.
 *
 * Caching is a server concern, never a core one: the model parser, the projection and the layout
 * engines stay pure and are always safe to call directly. Keeping the store behind this small
 * interface means a different eviction policy — or none — is a local change, and tests can clear
 * it or read its counters without reaching into module state.
 */
export interface Cache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
  /** Hits and misses since the last clear. Exposed so tests can prove work was skipped. */
  readonly stats: { hits: number; misses: number };
}

/** Least-recently-used by insertion order: a hit re-inserts, so the oldest key is evicted first. */
export function createCache<T>(limit: number): Cache<T> {
  const entries = new Map<string, T>();
  const stats = { hits: 0, misses: 0 };
  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) {
        stats.misses += 1;
        return undefined;
      }
      stats.hits += 1;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > limit) entries.delete(entries.keys().next().value!);
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
      stats.hits = 0;
      stats.misses = 0;
    },
    get size() {
      return entries.size;
    },
    stats
  };
}
