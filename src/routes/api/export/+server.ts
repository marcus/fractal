import { json } from '@sveltejs/kit';
import { loadModel } from '$lib/server/models';
import { layout } from '$lib/adapters/elk-layout';
import { exportHtml } from '$lib/adapters/html';
import { exportSvg } from '$lib/core/svg';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
  try {
    const input = await request.json();
    const { model, revision, sequences } = await loadModel(input.model);
    if (input.revision !== undefined && input.revision !== revision)
      throw new Error(
        'The model changed on disk. Reload the model from Model source before continuing.'
      );
    if (input.format !== undefined && !['svg', 'html'].includes(input.format))
      throw new Error('Format must be svg or html');
    if (input.format === 'html') {
      return new Response(
        await exportHtml(model, { state: input.state, scene: input.scene, sequences }),
        {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-disposition': `attachment; filename="${model.id}.html"`
          }
        }
      );
    }
    const diagram = await layout(model, input.state);
    return new Response(
      exportSvg(model, diagram, { title: input.title, subtitle: input.subtitle }),
      {
        headers: {
          'content-type': 'image/svg+xml; charset=utf-8',
          'content-disposition': `attachment; filename="${model.id}.svg"`
        }
      }
    );
  } catch (error) {
    return json({ error: String(error) }, { status: 400 });
  }
};
