import { json } from '@sveltejs/kit';
import { loadModel } from '$lib/server/models';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ params }) => {
  try {
    return json(await loadModel(params.id));
  } catch (error) {
    return json({ error: String(error) }, { status: 400 });
  }
};
