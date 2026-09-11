import { json } from '@sveltejs/kit';
import { renderSequence } from '$lib/server/sequence';
import { exportSequenceSvg } from '$lib/sequence/svg';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { journey, diagram } = await renderSequence(await request.json());
    return new Response(exportSequenceSvg(journey, diagram), {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'content-disposition': `attachment; filename="${journey.id}.svg"`
      }
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
