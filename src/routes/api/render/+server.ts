import { json } from '@sveltejs/kit';
import { loadModel } from '$lib/server/models';
import { renderDiagram } from '$lib/server/render';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
  try {
    const input = await request.json();
    const loaded = await loadModel(input.model);
    if (input.revision !== undefined && input.revision !== loaded.revision)
      throw new Error(
        'The model changed on disk. Reload the model from Model source before continuing.'
      );
    return json(await renderDiagram(loaded, input.state));
  } catch (error) {
    return json({ error: String(error) }, { status: 400 });
  }
};
