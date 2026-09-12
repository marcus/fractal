import type { Element, Model, Status, ViewState } from './types';

export interface SearchResult {
  readonly id: string;
  readonly type: 'element' | 'relationship' | 'scene';
  readonly title: string;
  readonly description: string;
  readonly status?: Status;
}

export interface SearchSelection {
  readonly id: string;
  readonly type: 'element' | 'relationship';
}

export interface RevealedSearchResult {
  readonly view: ViewState;
  readonly selected: SearchSelection | null;
}

const MAX_RESULTS = 100;

function normalized(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().trim().replace(/\s+/g, ' ');
}

function resultLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 30;
  return Math.min(MAX_RESULTS, Math.max(0, Math.floor(limit)));
}

interface Candidate {
  readonly result: SearchResult;
  readonly title: string;
  readonly id: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly order: number;
}

function occurrenceScore(value: string, token: string, weight: number): number | null {
  if (value === token) return weight;
  if (value.startsWith(token)) return weight + 2;
  if (value.split(/[^\p{L}\p{N}._-]+/u).some((word) => word.startsWith(token))) return weight + 4;
  return value.includes(token) ? weight + 8 : null;
}

function candidateScore(
  candidate: Candidate,
  query: string,
  tokens: readonly string[]
): number | null {
  const fields = [
    [candidate.title, 0],
    [candidate.id, 7],
    ...candidate.aliases.map((alias) => [alias, 12] as const),
    [candidate.description, 30]
  ] as const;
  let score = 0;
  for (const token of tokens) {
    const scores = fields
      .map(([value, weight]) => occurrenceScore(value, token, weight))
      .filter((value): value is number => value !== null);
    if (!scores.length) return null;
    score += Math.min(...scores);
  }
  if (candidate.title === query) score -= 1000;
  else if (candidate.id === query) score -= 900;
  else if (candidate.title.startsWith(query)) score -= 700;
  else if (candidate.title.includes(query)) score -= 400;
  else if (candidate.aliases.some((alias) => alias === query)) score -= 300;
  return score;
}

/** Search the complete authored model, independent of the current projection. */
export function searchModel(model: Model, query: string, limit = 30): SearchResult[] {
  const take = resultLimit(limit);
  if (!take) return [];

  const elementNames = new Map(model.elements.map((element) => [element.id, element.title]));
  const candidates: Candidate[] = [];
  let order = 0;
  for (const element of model.elements) {
    candidates.push({
      result: {
        id: element.id,
        type: 'element',
        title: element.title,
        description: element.description,
        status: element.status
      },
      title: normalized(element.title),
      id: normalized(element.id),
      aliases: [
        normalized(element.sourceId),
        normalized(element.kind),
        normalized(element.technology)
      ],
      description: normalized(element.description),
      order: order++
    });
  }
  for (const relationship of model.relationships) {
    const source = elementNames.get(relationship.source) ?? relationship.source;
    const target = elementNames.get(relationship.target) ?? relationship.target;
    candidates.push({
      result: {
        id: relationship.id,
        type: 'relationship',
        title: relationship.title,
        description: `${source} → ${target}${relationship.description ? ` · ${relationship.description}` : ''}`,
        status: relationship.status
      },
      title: normalized(relationship.title),
      id: normalized(relationship.id),
      aliases: [source, target, relationship.source, relationship.target, relationship.kind].map(
        normalized
      ),
      description: normalized(relationship.description),
      order: order++
    });
  }
  for (const scene of model.scenes) {
    candidates.push({
      result: {
        id: scene.id,
        type: 'scene',
        title: scene.title,
        description: scene.description
      },
      title: normalized(scene.title),
      id: normalized(scene.id),
      aliases: [normalized(scene.lens)],
      description: normalized(scene.description),
      order: order++
    });
  }

  const normalizedQuery = normalized(query);
  if (!normalizedQuery) {
    const scenes = candidates.filter((candidate) => candidate.result.type === 'scene');
    const roots = candidates.filter(
      (candidate) =>
        candidate.result.type === 'element' &&
        model.elements.find((element) => element.id === candidate.result.id)?.parent === null
    );
    return [...scenes, ...roots].slice(0, take).map((candidate) => candidate.result);
  }

  const tokens = normalizedQuery.split(' ');
  return candidates
    .map((candidate) => ({ candidate, score: candidateScore(candidate, normalizedQuery, tokens) }))
    .filter((entry): entry is { candidate: Candidate; score: number } => entry.score !== null)
    .sort((left, right) => left.score - right.score || left.candidate.order - right.candidate.order)
    .slice(0, take)
    .map(({ candidate }) => candidate.result);
}

function elementLineage(byId: ReadonlyMap<string, Element>, id: string): Element[] {
  const lineage: Element[] = [];
  const visited = new Set<string>();
  let current: string | null = id;
  while (current) {
    if (visited.has(current)) throw new Error(`Containment cycle at: ${current}`);
    visited.add(current);
    const element = byId.get(current);
    if (!element) throw new Error(`Unknown element: ${current}`);
    lineage.push(element);
    current = element.parent;
  }
  return lineage;
}

function within(lineage: readonly Element[], scope: string | undefined): boolean {
  return scope === undefined || lineage.some((element) => element.id === scope);
}

function revealedView(
  byId: ReadonlyMap<string, Element>,
  current: ViewState,
  lineages: readonly (readonly Element[])[],
  proposed: boolean
): ViewState {
  const requested = new Set(current.expanded);
  for (const lineage of lineages) {
    for (const ancestor of lineage.slice(1)) requested.add(ancestor.id);
  }
  const scope = lineages.every((lineage) => within(lineage, current.scope))
    ? current.scope
    : undefined;
  const expanded = new Set<string>();
  for (const id of requested) {
    const lineage = elementLineage(byId, id).reverse();
    const visibleLineage =
      scope === undefined
        ? lineage
        : lineage.slice(lineage.findIndex((element) => element.id === scope));
    if (scope !== undefined && visibleLineage[0]?.id !== scope) continue;
    for (const element of visibleLineage) expanded.add(element.id);
  }
  return {
    ...current,
    expanded: [...expanded],
    proposed:
      current.proposed ||
      proposed ||
      lineages.some((lineage) => lineage.some((element) => element.status === 'proposed')),
    ...(scope === undefined ? { scope: undefined } : { scope })
  };
}

/** Build the view that makes a result's authored identity directly addressable. */
export function revealSearchResult(
  model: Model,
  currentView: ViewState,
  result: SearchResult
): RevealedSearchResult {
  if (result.type === 'scene') {
    const scene = model.scenes.find((candidate) => candidate.id === result.id);
    if (!scene) throw new Error(`Unknown scene: ${result.id}`);
    return {
      view: {
        expanded: [...scene.expanded],
        proposed: scene.proposed,
        lens: scene.lens,
        ...(scene.scope ? { scope: scene.scope } : {}),
        ...((scene.theme ?? currentView.theme) ? { theme: scene.theme ?? currentView.theme } : {}),
        ...(scene.layout ? { layout: scene.layout } : {})
      },
      selected: null
    };
  }

  const byId = new Map(model.elements.map((element) => [element.id, element]));

  if (result.type === 'element') {
    const lineage = elementLineage(byId, result.id);
    return {
      view: revealedView(byId, currentView, [lineage], false),
      selected: { id: result.id, type: 'element' }
    };
  }

  const relationship = model.relationships.find((candidate) => candidate.id === result.id);
  if (!relationship) throw new Error(`Unknown relationship: ${result.id}`);
  const source = elementLineage(byId, relationship.source);
  const target = elementLineage(byId, relationship.target);
  return {
    view: revealedView(byId, currentView, [source, target], relationship.status === 'proposed'),
    selected: { id: relationship.id, type: 'relationship' }
  };
}
