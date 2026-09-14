import { json } from '@sveltejs/kit';
import { validateLinked } from '$lib/server/composition';
import type { RequestHandler } from './$types';

/** Strict linked validation of a root and its declared link closure. */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const input = (await request.json()) as { model?: unknown };
    if (typeof input.model !== 'string' || !input.model)
      return json({ error: 'model is required' }, { status: 400 });
    return json(await validateLinked(input.model));
  } catch (error) {
    return json({ error: (error as Error).message }, { status: 400 });
  }
};
