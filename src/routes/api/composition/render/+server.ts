import { json } from '@sveltejs/kit';
import { CompositionContractError } from '$lib/composition/parse';
import { composeFromSelector, revisionConflict } from '$lib/server/composition';
import type { RequestHandler } from './$types';

interface RenderInput {
  root?: unknown;
  composition?: unknown;
  state?: unknown;
  revisions?: unknown;
}

/**
 * Resolve, lay out and place a composition. Only catalog entries are ever loaded; the route
 * accepts no directories or URLs. Invalid input is 400, a changed participating revision is 409,
 * a state payload over budget is 422, and recoverable target failures stay 200 with diagnostics.
 */
export const POST: RequestHandler = async ({ request }) => {
  let input: RenderInput;
  try {
    input = (await request.json()) as RenderInput;
  } catch {
    return json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  if (typeof input.root !== 'string' || !input.root)
    return json({ error: 'root is required' }, { status: 400 });

  try {
    const result = await composeFromSelector(input.root, {
      ...(typeof input.composition === 'string' ? { composition: input.composition } : {}),
      ...(input.state === undefined ? {} : { state: input.state })
    });
    if (input.revisions !== undefined && input.revisions !== null) {
      if (typeof input.revisions !== 'object' || Array.isArray(input.revisions))
        return json({ error: 'revisions must be an object' }, { status: 400 });
      for (const revision of Object.values(input.revisions as Record<string, unknown>))
        if (typeof revision !== 'string')
          return json({ error: 'revisions values must be strings' }, { status: 400 });
      const conflict = revisionConflict(
        result.revisions,
        input.revisions as Record<string, string>
      );
      if (conflict) return json(conflict, { status: 409 });
    }
    return json(result);
  } catch (error) {
    if (error instanceof CompositionContractError && error.code === 'budget_exceeded')
      return json({ error: error.message, code: 'budget_exceeded' }, { status: 422 });
    return json({ error: (error as Error).message }, { status: 400 });
  }
};
