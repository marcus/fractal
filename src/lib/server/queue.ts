/**
 * One bounded work queue per server for resolution and layout jobs.
 *
 * At most two jobs run at once; the rest wait in a bounded FIFO. Identical in-flight
 * requests share one promise instead of redoing work. A request that names a `client`
 * and carries an older `generation` than the latest seen for that root+client is
 * answered `stale` without doing work — that caller already dispatched something newer.
 * Generations are client-owned: the latest-generation key is root plus client, so two
 * tabs never stale each other. Without a client id the queue never answers stale; it
 * still coalesces identical in-flight work. Unrelated roots never stall each other.
 */

/** The queue is full: every worker is busy and no waiting slot remains. */
export class QueueFullError extends Error {
  readonly code = 'server_busy' as const;
  readonly recovery = 'retry' as const;
  constructor() {
    super('The composition work queue is full. Retry the request.');
    this.name = 'QueueFullError';
  }
}

export interface StaleOutcome {
  status: 'stale';
  generation: number;
  current: number;
}

export interface ReadyOutcome<T> {
  status: 'ready';
  result: T;
  coalesced: boolean;
}

export type QueueOutcome<T> = StaleOutcome | ReadyOutcome<T>;

export interface JobsSnapshot {
  active: number;
  queued: number;
  completed: number;
  coalesced: number;
}

export interface WorkQueue {
  submit<T>(
    scope: string,
    key: string,
    work: () => Promise<T>,
    options?: { generation?: number; client?: string }
  ): Promise<QueueOutcome<T>>;
  snapshot(): JobsSnapshot;
  /** Clear generations and counters. Only reset when idle: queued waiters are not resumed. */
  reset(): void;
}

const STALE = Symbol('stale');

function isStale(generation: number | undefined, current: number | undefined): boolean {
  return generation !== undefined && current !== undefined && generation < current;
}

export function createWorkQueue(options: { concurrency: number; maxWaiting?: number }): WorkQueue {
  const concurrency = options.concurrency;
  const maxWaiting = options.maxWaiting ?? 64;
  let active = 0;
  let completed = 0;
  let coalesced = 0;
  const waiting: Array<() => void> = [];
  const inFlight = new Map<string, Promise<unknown>>();
  const latest = new Map<string, number>();

  function pump(): void {
    while (active < concurrency && waiting.length > 0) {
      active += 1;
      const start = waiting.shift();
      start?.();
    }
  }

  return {
    async submit<T>(
      scope: string,
      key: string,
      work: () => Promise<T>,
      submitOptions: { generation?: number; client?: string } = {}
    ): Promise<QueueOutcome<T>> {
      const generation = submitOptions.generation;
      const client = submitOptions.client;
      const flightKey = `${scope}\0${key}`;
      // Latest-generation tracking is per root+client. No client means no stale answers.
      const latestKey = client === undefined ? undefined : `${scope}\0${client}`;
      const current = latestKey === undefined ? undefined : latest.get(latestKey);
      if (latestKey !== undefined && isStale(generation, current))
        return { status: 'stale', generation: generation as number, current: current as number };
      if (
        latestKey !== undefined &&
        generation !== undefined &&
        (current === undefined || generation > current)
      )
        latest.set(latestKey, generation);

      // A shared outcome can go stale while we wait on it (a newer generation for this
      // client arrived after its owner queued). When that happens and our own generation is
      // still current, fall through and run as fresh work instead of inheriting the stale
      // answer. The loop terminates: every retry needs a strictly newer generation to have
      // arrived, which eventually supersedes us too.
      for (;;) {
        const flying = inFlight.get(flightKey);
        if (flying === undefined) break;
        const shared = (await flying) as T | typeof STALE;
        if (shared !== STALE) {
          coalesced += 1;
          return { status: 'ready', result: shared, coalesced: true };
        }
        const now = latestKey === undefined ? undefined : latest.get(latestKey);
        if (
          latestKey !== undefined &&
          generation !== undefined &&
          now !== undefined &&
          generation < now
        )
          return { status: 'stale', generation, current: now };
      }

      // A request that starts at once never waited, so no newer generation can have
      // superseded it; only a request that actually queued is re-checked on dequeue. Once
      // started, a job always runs to completion — the caller discards superseded
      // responses by generation instead.
      const immediate = active < concurrency;
      if (!immediate && waiting.length >= maxWaiting) throw new QueueFullError();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (immediate) active += 1;
      const outcome: Promise<T | typeof STALE> = (async () => {
        try {
          if (!immediate) {
            await gate;
            // A newer generation for this client may have arrived while queued.
            if (latestKey !== undefined && isStale(generation, latest.get(latestKey))) return STALE;
          }
          try {
            return await work();
          } finally {
            completed += 1;
          }
        } finally {
          active -= 1;
          inFlight.delete(flightKey);
          pump();
        }
      })();
      inFlight.set(flightKey, outcome);
      if (!immediate) {
        waiting.push(release);
        pump();
      }
      const result = await outcome;
      if (result === STALE) {
        const now = (latestKey === undefined ? undefined : latest.get(latestKey)) ?? 0;
        return { status: 'stale', generation: generation ?? now, current: now };
      }
      return { status: 'ready', result, coalesced: false };
    },
    snapshot(): JobsSnapshot {
      return { active: active, queued: waiting.length, completed, coalesced };
    },
    reset(): void {
      latest.clear();
      waiting.length = 0;
      active = 0;
      completed = 0;
      coalesced = 0;
    }
  };
}

/**
 * The server-wide composition queue: at most two concurrent resolution/layout jobs, shared
 * by every composition render the HTTP service answers. The CLI calls the boundary
 * directly and never queues.
 */
export const compositionWorkQueue: WorkQueue = createWorkQueue({ concurrency: 2 });

/** Forget generations and job counters. Tests use this to start from an idle queue. */
export function resetCompositionQueue(): void {
  compositionWorkQueue.reset();
}
