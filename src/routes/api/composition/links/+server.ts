import { json } from '@sveltejs/kit';
import { linksFor } from '$lib/server/composition';
import type { RequestHandler } from './$types';

/** Discover a root's authored links and the resolution status of every foreign model. */
export const GET: RequestHandler = async ({ url }) => {
  const model = url.searchParams.get('model');
  if (!model) return json({ error: 'model is required' }, { status: 400 });
  try {
    return json(await linksFor(model));
  } catch (error) {
    return json({ error: (error as Error).message }, { status: 400 });
  }
};
