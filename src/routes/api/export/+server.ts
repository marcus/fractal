import { json } from '@sveltejs/kit';
import { CompositionContractError } from '$lib/composition/parse';
import type { RevisionVector } from '$lib/composition/revision';
import type { ViewState } from '$lib/core/types';
import { loadModel, snapshotOf } from '$lib/server/models';
import { renderDiagram } from '$lib/server/render';
import { exportHtml } from '$lib/adapters/html';
import { exportSvg } from '$lib/core/svg';
import {
  BudgetExceededError,
  CompositionUsageError,
  RevisionConflictError
} from '$lib/server/composition';
import { ExportUnresolvedError, exportComposition } from '$lib/server/export';
import { SourceChangingError } from '$lib/server/models';
import type { RequestHandler } from './$types';

interface CompositionExportInput {
  /** Authored composition ID from the root's links.json. */
  composition?: unknown;
  /**
   * Explicit composition state: a decoded object or a versioned encoded `v1.` permalink
   * value. Mutually exclusive with `composition`. Named `compositionState` (not `state`)
   * because single-model export already uses `state` for its ViewState.
   */
  compositionState?: unknown;
  format?: unknown;
  allowUnresolved?: unknown;
  revisions?: unknown;
}

interface SingleModelExportInput {
  model: string;
  revision?: unknown;
  state?: ViewState;
  scene?: string;
  title?: string;
  subtitle?: string;
  format?: unknown;
  /** Extra catalog IDs to embed with the root for HTML export. */
  include?: unknown;
}

type ExportInput = CompositionExportInput & SingleModelExportInput;

/**
 * Export artwork. Without a composition selector the request is the unchanged
 * single-model export: the same SVG bytes, content type and disposition as before.
 *
 * With `composition` or `compositionState` the request exports the composed diagram
 * (every project frame, bridge, port and stub, independent of viewport culling) as SVG
 * or PNG. The artwork is the response body; the JSON export report — included projects
 * with revisions, composition state, omitted unopened links, unresolved diagnostics and
 * format — travels base64url-encoded in the `x-fractal-export-manifest` response
 * header, the same shape the CLI prints with `--json`. A failed participating target
 * fails the export with 422 and diagnostics unless `allowUnresolved: true` renders
 * unavailable cards instead. Unopened links are intentional omissions in the manifest,
 * never errors, and are never resolved. Admission limits are checked before output is
 * allocated; an over-limit composition is 422. Invalid input is 400, a changed
 * participating revision or a source changing under the read is 409.
 */
/** Explicit composition state: a decoded object or a versioned `v1.` permalink value. */
function isCompositionStateInput(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    (typeof value === 'object' && value !== null && !Array.isArray(value))
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}

export const POST: RequestHandler = async ({ request }) => {
  const text = await request.text();
  let input: ExportInput;
  try {
    input = JSON.parse(text) as ExportInput;
  } catch (error) {
    // Composition requests name their selector, so a body that names one keeps the
    // explicit parse diagnostic; every other body keeps the historical single-model
    // `{ error: String(parseError) }` shape byte-identical.
    if (/"composition(?:State)?"\s*:/.test(text))
      return json({ error: 'Request body must be JSON.' }, { status: 400 });
    return json({ error: String(error) }, { status: 400 });
  }
  // A non-object body never names a selector; it falls through to the single-model
  // path and fails there exactly as before.
  const body = typeof input === 'object' && input !== null ? input : null;
  if (body !== null && body.include !== undefined && !isStringArray(body.include))
    return json({ error: 'include must be an array of strings' }, { status: 400 });
  if (body !== null && (body.composition !== undefined || body.compositionState !== undefined)) {
    const input = body;
    if (input.composition !== undefined && typeof input.composition !== 'string')
      return json({ error: 'composition must be a string' }, { status: 400 });
    if (input.compositionState !== undefined && !isCompositionStateInput(input.compositionState))
      return json(
        { error: 'compositionState must be a decoded state object or a v1. value' },
        { status: 400 }
      );
    if (input.allowUnresolved !== undefined && typeof input.allowUnresolved !== 'boolean')
      return json({ error: 'allowUnresolved must be a boolean' }, { status: 400 });
    if (input.format !== undefined && input.format !== 'svg' && input.format !== 'png')
      return json({ error: 'Composition export format must be svg or png' }, { status: 400 });
    if (typeof input.model !== 'string' || !input.model)
      return json({ error: 'model is required' }, { status: 400 });
    try {
      const format = input.format === 'png' ? 'png' : 'svg';
      const exported = await exportComposition(
        input.model,
        {
          ...(typeof input.composition === 'string' ? { composition: input.composition } : {}),
          ...(input.compositionState === undefined ? {} : { state: input.compositionState })
        },
        {
          format,
          ...(input.allowUnresolved === true ? { allowUnresolved: true } : {}),
          ...(input.revisions === undefined || input.revisions === null
            ? {}
            : { revisions: input.revisions as RevisionVector })
        }
      );
      const manifest = Buffer.from(JSON.stringify(exported.manifest), 'utf8').toString('base64url');
      const body = format === 'png' ? new Uint8Array(exported.png!) : exported.svg;
      return new Response(body, {
        headers: {
          'content-type': format === 'png' ? 'image/png' : 'image/svg+xml; charset=utf-8',
          'content-disposition': `attachment; filename="${input.model}-composition.${format}"`,
          'x-fractal-export-manifest': manifest
        }
      });
    } catch (error) {
      if (error instanceof ExportUnresolvedError)
        return json(
          { error: error.message, code: error.code, diagnostics: error.diagnostics },
          { status: 422 }
        );
      if (error instanceof BudgetExceededError)
        return json(
          { error: error.message, code: error.code, diagnostics: error.diagnostics },
          { status: 422 }
        );
      if (error instanceof RevisionConflictError)
        return json(
          {
            error: error.message,
            code: error.code,
            model: error.model,
            expected: error.expected,
            actual: error.actual,
            recovery: error.recovery
          },
          { status: 409 }
        );
      if (error instanceof SourceChangingError)
        return json(
          { error: error.message, code: error.code, recovery: error.recovery },
          { status: 409 }
        );
      if (error instanceof CompositionUsageError || error instanceof CompositionContractError)
        return json({ error: (error as Error).message }, { status: 400 });
      return json({ error: String(error) }, { status: 400 });
    }
  }
  try {
    const loaded = await loadModel(input.model);
    const { model, revision, sequences } = loaded;
    // The single-model contract accepts any JSON body; a missing view state fails
    // downstream exactly as before, so narrow here without changing runtime behavior.
    const state = input.state as ViewState;
    if (input.revision !== undefined && input.revision !== revision)
      throw new Error(
        'The model changed on disk. Reload the model from Model source before continuing.'
      );
    if (input.format !== undefined && !['svg', 'html'].includes(input.format as string))
      throw new Error('Format must be svg or html');
    if (input.format === 'html') {
      const include = input.include;
      if (isStringArray(include)) {
        const snapshots = [snapshotOf(loaded)];
        const sequencesByModel: Record<string, typeof sequences> = { [model.id]: sequences };
        for (const id of include) {
          if (id === model.id) continue;
          const other = await loadModel(id);
          snapshots.push(snapshotOf(other));
          sequencesByModel[id] = other.sequences;
        }
        return new Response(
          await exportHtml(model, {
            state,
            scene: input.scene,
            sequences,
            include,
            snapshots,
            sequencesByModel
          }),
          {
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'content-disposition': `attachment; filename="${model.id}.html"`
            }
          }
        );
      }
      // The document embeds the same geometry the reader is looking at, so it can reuse the
      // layout the studio just computed.
      return new Response(
        await exportHtml(model, {
          state,
          scene: input.scene,
          sequences,
          diagram: () => renderDiagram(loaded, state)
        }),
        {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-disposition': `attachment; filename="${model.id}.html"`
          }
        }
      );
    }
    const diagram = await renderDiagram(loaded, state);
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
