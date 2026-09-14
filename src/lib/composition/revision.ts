import type { CompositionDiagnostic } from './types';

/**
 * Revision ownership for a composition. A composition replays against current sources
 * (permalinks are view intent, not archival locks), so every composed result carries the
 * revision vector it was built from and callers compare vectors before reusing geometry.
 */

/** Content revisions keyed by participating model, in no significant order. */
export type RevisionVector = Record<string, string>;

export interface RevisionMismatch {
  model: string;
  expected: string;
  actual: string;
}

/**
 * Compare the vector a caller composed against with the vector just loaded. Only models
 * present in both vectors can conflict, and only when their revisions differ; a model the
 * loader never resolved has no actual revision and is ignored. Results are sorted by
 * model so the first conflict is deterministic.
 */
export function revisionConflicts(
  expected: RevisionVector,
  actual: RevisionVector
): RevisionMismatch[] {
  const conflicts: RevisionMismatch[] = [];
  for (const model of Object.keys(expected).sort()) {
    const observed = actual[model];
    if (observed !== undefined && observed !== expected[model])
      conflicts.push({ model, expected: expected[model], actual: observed });
  }
  return conflicts;
}

/**
 * A participating source changed under a coherent view: keep the last coherent view
 * visibly awaiting reload, never silently mix the new model with old geometry.
 */
export function revisionChangedDiagnostic(model: string, owner: string): CompositionDiagnostic {
  return {
    code: 'revision_changed',
    ownerModel: owner,
    message: `${model} changed on disk. Reload the composition before continuing.`,
    target: { model },
    recovery: 'reload'
  };
}

/**
 * The source is changing concurrently (a stamp check failed around the read, even after
 * one retry for concurrent writes): the load did not complete, and retrying is safe.
 */
export function sourceChangingDiagnostic(model: string, owner: string): CompositionDiagnostic {
  return {
    code: 'source_changing',
    ownerModel: owner,
    message: `${model} is changing on disk. Retry the load.`,
    target: { model },
    recovery: 'retry'
  };
}

/**
 * Composition generations discard obsolete responses: rapid toggles coalesce, and a
 * cancelled or older generation never replaces newer state. Generations are plain
 * monotonically increasing numbers owned by the request dispatcher.
 */
export type CompositionGeneration = number;

/** The generation after `current` (the first generation when omitted). */
export function nextGeneration(current: CompositionGeneration = 0): CompositionGeneration {
  return current + 1;
}

/** True when `generation` has been superseded by a newer dispatched `current`. */
export function isStale(
  generation: CompositionGeneration,
  current: CompositionGeneration
): boolean {
  return generation < current;
}
