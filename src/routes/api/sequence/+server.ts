import { json } from '@sveltejs/kit';
import { renderSequence } from '$lib/server/sequence';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    return json((await renderSequence(await request.json())).diagram);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
