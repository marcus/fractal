import { json } from '@sveltejs/kit';
import { loadModel } from '$lib/server/models';
import { renderDiagram } from '$lib/server/render';
import { exportHtml } from '$lib/adapters/html';
import { exportSvg } from '$lib/core/svg';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
  try {
    const input = await request.json();
    const loaded = await loadModel(input.model);
    const { model, revision, sequences } = loaded;
    if (input.revision !== undefined && input.revision !== revision)
      throw new Error(
        'The model changed on disk. Reload the model from Model source before continuing.'
      );
    if (input.format !== undefined && !['svg', 'html'].includes(input.format))
      throw new Error('Format must be svg or html');
    if (input.format === 'html') {
      // The document embeds the same geometry the reader is looking at, so it can reuse the
      // layout the studio just computed.
      return new Response(
        await exportHtml(model, {
          state: input.state,
          scene: input.scene,
          sequences,
          diagram: () => renderDiagram(loaded, input.state)
        }),
        {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-disposition': `attachment; filename="${model.id}.html"`
          }
        }
      );
    }
    const diagram = await renderDiagram(loaded, input.state);
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
