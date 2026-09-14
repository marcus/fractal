import { json } from '@sveltejs/kit';
import { CompositionContractError } from '$lib/composition/parse';
import {
  BudgetExceededError,
  searchInComposition,
  RevisionConflictError
} from '$lib/server/composition';
import { SourceChangingError } from '$lib/server/models';
import type { RequestHandler } from './$types';

/**
 * Search the participating projects of a composition through the shared core scorer.
 * `model` names the root, `q` is the query (empty matches everything), and the
 * composition is selected exactly like render: `composition` for an authored ID or
 * `state` for an explicit object or versioned encoded `v1.` permalink value (mutually
 * exclusive). Unopened link targets are never loaded; they appear as `link` metadata
 * results. Every hit carries its qualified selection and reveal hint.
 */
export const GET: RequestHandler = async ({ url }) => {
  const model = url.searchParams.get('model');
  if (!model) return json({ error: 'model is required' }, { status: 400 });
  const composition = url.searchParams.get('composition');
  const state = url.searchParams.get('state');
  if (composition !== null && state !== null)
    return json({ error: 'composition and state are mutually exclusive' }, { status: 400 });
  try {
    return json(
      await searchInComposition(
        model,
        {
          ...(composition === null ? {} : { composition }),
          ...(state === null ? {} : { state })
        },
        url.searchParams.get('q') ?? ''
      )
    );
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
