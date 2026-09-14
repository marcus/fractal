import { json } from '@sveltejs/kit';
import { getCompositionStats } from '$lib/server/composition';
import type { RequestHandler } from './$types';

/**
 * Cache hits/misses/entries/bytes/evictions, queue/jobs counts, rejected work (stale
 * generations, over-limit compositions) and the configured admission limits. The
 * composition benchmark reads this shape; see `getCompositionStats`.
 */
export const GET: RequestHandler = async () => {
  return json(getCompositionStats());
};
