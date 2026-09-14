import { json } from '@sveltejs/kit';
import { CompositionContractError } from '$lib/composition/parse';
import {
  BudgetExceededError,
  submitCompositionRender,
  RevisionConflictError,
  type CompositionRequest
} from '$lib/server/composition';
import { SourceChangingError } from '$lib/server/models';
import { QueueFullError } from '$lib/server/queue';
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
  /** Opaque per-tab identity that scopes generation tracking; omit to skip stale answers. */
  client?: unknown;
  /** Reload every participating snapshot fresh with stamp verification. */
  reload?: unknown;
}

/**
 * Resolve, lay out and place a composition through the server's bounded work queue (two
 * concurrent jobs, identical in-flight requests coalesced). Only catalog entries are ever
 * loaded; the route accepts no directories or URLs. Invalid input is 400, a changed
 * participating revision or a source that is changing under the read is 409, a state
 * payload or composition over budget is 422, an older generation than the latest for the
 * same root+client is 200 with a `stale` envelope (no work is done; without a client id
 * the queue never answers stale), a full queue is 429, and recoverable target failures
 * stay 200 with diagnostics.
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
      ...(input.client === undefined || input.client === null
        ? {}
        : { client: input.client as CompositionRequest['client'] }),
      ...(input.reload === true ? { reload: true as const } : {})
    };
    const outcome = await submitCompositionRender(input.root, selector, options);
    if (outcome.status === 'stale')
      return json({
        status: 'stale',
        generation: outcome.generation,
        current: outcome.current
      });
    return json(outcome.result);
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
    if (error instanceof QueueFullError)
      return json(
        { error: error.message, code: error.code, recovery: error.recovery },
        { status: 429 }
      );
    return json({ error: (error as Error).message }, { status: 400 });
  }
};
