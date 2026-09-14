import { revealSearchResult, searchModel, type SearchResult } from '../core/search';
import type { Status } from '../core/types';
import type { ProjectSnapshot } from './snapshot';
import type { CompositionState, QualifiedSelection } from './types';

/**
 * Qualified search over a composition. Elements, relationships and scenes reuse the shared
 * single-model scorer (`searchModel`) per participating project, so ranking never forks its
 * matching; boundaries and unopened-link metadata are covered here because the shared
 * scorer has no path for either.
 *
 * - Only participating projects (the state's entries, in state order) are searched, and only
 *   through already-loaded snapshots: an unopened link's target is never loaded to answer a
 *   query. Instead the authored link title, ID and target model appear as a `link` result.
 * - Every result carries the `QualifiedSelection` an inspector consumes and a reveal hint
 *   (`{ model, expanded }`) derived from `revealSearchResult` against that project's saved
 *   view, so outline/search selection can mount the hit before restoring focus.
 * - Ordering is deterministic: per-model score rank, then model, then id. The score is the
 *   hit's zero-based position in its own model's ordered hits (the observable proxy of the
 *   shared scorer); boundaries follow their model's scored hits, and unopened links follow
 *   their owner's hits.
 */

export type CompositionSearchKind = 'element' | 'relationship' | 'boundary' | 'scene' | 'link';

export interface CompositionSearchResult {
  /** The project where the hit lives; for `link` results this is the owning project. */
  model: string;
  kind: CompositionSearchKind;
  id: string;
  title: string;
  description: string;
  status?: Status;
  /** Zero-based position in the model's own ordered hits; lower ordered first. */
  score: number;
  selection: QualifiedSelection;
  /** The project whose view reveals the hit, and the expansion that mounts it. */
  reveal: { model: string; expanded: string[] };
  /** Present only on `link` results: the project that authored the unopened link. */
  owner?: string;
  linkId?: string;
  target?: { model: string; scene?: string };
}

function normalized(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Token matcher for the two kinds the shared scorer does not cover. Every query token must
 * appear as a substring of one of the candidate fields; an empty query matches everything,
 * mirroring the shared scorer's overview behavior.
 */
function matchesFields(fields: readonly string[], query: string): boolean {
  const tokens = normalized(query).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const haystacks = fields.map(normalized);
  return tokens.every((token) => haystacks.some((field) => field.includes(token)));
}

function projectView(model: string, state: CompositionState): { expanded: string[] } {
  const entry = state.projects.find((project) => project.model === model);
  return { expanded: entry ? [...entry.view.expanded] : [] };
}

function currentView(
  state: CompositionState,
  owner: string
): Parameters<typeof revealSearchResult>[1] {
  const entry = state.projects.find((project) => project.model === owner);
  return {
    expanded: entry ? [...entry.view.expanded] : [],
    proposed: entry?.view.proposed ?? false,
    lens: entry?.view.lens ?? 'structure',
    ...(entry?.view.scope === undefined ? {} : { scope: entry.view.scope }),
    theme: state.theme,
    layout: state.layout
  };
}

function selectionFor(model: string, result: SearchResult): QualifiedSelection {
  if (result.type === 'element') return { kind: 'element', model, element: result.id };
  if (result.type === 'relationship')
    return { kind: 'relationship', model, relationship: result.id };
  return { kind: 'scene', model, scene: result.id };
}

export function searchComposition(
  snapshots: Map<string, ProjectSnapshot>,
  state: CompositionState,
  query: string
): CompositionSearchResult[] {
  const results: CompositionSearchResult[] = [];
  for (const project of state.projects) {
    const snapshot = snapshots.get(project.model);
    if (!snapshot) continue;
    const hits = searchModel(snapshot.model, query);
    hits.forEach((hit, index) => {
      const revealed = revealSearchResult(snapshot.model, currentView(state, project.model), hit);
      results.push({
        model: project.model,
        kind: hit.type,
        id: hit.id,
        title: hit.title,
        description: hit.description,
        ...(hit.status === undefined ? {} : { status: hit.status }),
        score: index,
        selection: selectionFor(project.model, hit),
        reveal: { model: project.model, expanded: [...revealed.view.expanded] }
      });
    });
    const boundaries = [...snapshot.model.boundaries].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );
    boundaries.forEach((boundary, offset) => {
      if (!matchesFields([boundary.title, boundary.id, boundary.description, boundary.kind], query))
        return;
      results.push({
        model: project.model,
        kind: 'boundary',
        id: boundary.id,
        title: boundary.title,
        description: boundary.description,
        score: hits.length + offset,
        selection: { kind: 'boundary', model: project.model, boundary: boundary.id },
        reveal: { model: project.model, expanded: projectView(project.model, state).expanded }
      });
    });
    const links = [...(snapshot.links?.links ?? [])].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );
    links.forEach((link, offset) => {
      // A loaded target is searched as a model; only unopened links appear as metadata.
      if (snapshots.has(link.target.model)) return;
      if (!matchesFields([link.title, link.id, link.target.model], query)) return;
      results.push({
        model: project.model,
        kind: 'link',
        id: link.id,
        title: link.title,
        description: `${project.model} → ${link.target.model}`,
        score: hits.length + boundaries.length + offset,
        selection:
          link.from === undefined
            ? { kind: 'project', model: project.model }
            : { kind: 'element', model: project.model, element: link.from },
        reveal: { model: project.model, expanded: projectView(project.model, state).expanded },
        owner: project.model,
        linkId: link.id,
        target: {
          model: link.target.model,
          ...(link.target.scene === undefined ? {} : { scene: link.target.scene })
        }
      });
    });
  }
  results.sort(
    (a, b) =>
      a.score - b.score ||
      (a.model < b.model ? -1 : a.model > b.model ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  return results;
}
