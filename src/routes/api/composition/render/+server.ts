import { json } from '@sveltejs/kit';
import { CompositionContractError } from '$lib/composition/parse';
import {
  BudgetExceededError,
  composeFromSelector,
  RevisionConflictError,
  type CompositionRequest
} from '$lib/server/composition';
import { SourceChangingError } from '$lib/server/models';
import type { RequestHandler } from './$types';

interface RenderInput {
  root?: unknown;
  composition?: unknown;
  /** Explicit state: a decoded object or a versioned encoded `v1.` permalink value. */
  state?: unknown;
  /** The revision vector the caller composed against; a mismatch is 409. */
  revisions?: unknown;
  /** Client-owned generation, echoed verbatim so callers discard superseded responses. */
  generation?: unknown;
  /** Reload every participating snapshot fresh with stamp verification. */
  reload?: unknown;
}

/**
 * Resolve, lay out and place a composition. Only catalog entries are ever loaded; the route
 * accepts no directories or URLs. Invalid input is 400, a changed participating revision or
 * a source that is changing under the read is 409, a state payload or composition over
 * budget is 422, and recoverable target failures stay 200 with diagnostics.
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
    const selector = {
      ...(typeof input.composition === 'string' ? { composition: input.composition } : {}),
      ...(input.state === undefined ? {} : { state: input.state })
    };
    const options: CompositionRequest = {
      ...(input.revisions === undefined || input.revisions === null
        ? {}
        : { revisions: input.revisions as CompositionRequest['revisions'] }),
      ...(input.generation === undefined || input.generation === null
        ? {}
        : { generation: input.generation as CompositionRequest['generation'] }),
      ...(input.reload === true ? { reload: true as const } : {})
    };
    return json(await composeFromSelector(input.root, selector, options));
  } catch (error) {
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
    if (error instanceof BudgetExceededError)
      return json(
        { error: error.message, code: error.code, diagnostics: error.diagnostics },
        { status: 422 }
      );
    if (error instanceof CompositionContractError && error.code === 'budget_exceeded')
      return json({ error: error.message, code: 'budget_exceeded' }, { status: 422 });
    return json({ error: (error as Error).message }, { status: 400 });
  }
};
