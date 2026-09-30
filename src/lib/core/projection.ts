import type { Element, Model, Projection, ProjectedEdge, Relationship, ViewState } from './types';
import { getTheme } from './themes';
import { getLayoutEngineInfo } from './layout-engines';

/** Visibility is a projection of authored identities; collapsing never rewrites the model. */
export function project(model: Model, state: ViewState): Projection {
  getTheme(state.theme);
  getLayoutEngineInfo(state.layout);
  if (state.edges !== undefined && !['detail', 'summary'].includes(state.edges))
    throw new Error('Invalid view state');
  if (
    !['structure', 'trust'].includes(state.lens) ||
    typeof state.proposed !== 'boolean' ||
    !Array.isArray(state.expanded)
  ) {
    throw new Error('Invalid view state');
  }
  const byId = new Map<string, Element>();
  for (const element of model.elements) {
    if (byId.has(element.id)) throw new Error(`Duplicate element: ${element.id}`);
    byId.set(element.id, element);
  }
  for (const element of model.elements) {
    const visited = new Set([element.id]);
    let parent = element.parent;
    while (parent !== null) {
      if (!byId.has(parent)) throw new Error(`Unknown parent: ${parent}`);
      if (visited.has(parent)) throw new Error(`Containment cycle at: ${parent}`);
      visited.add(parent);
      parent = byId.get(parent)!.parent;
    }
  }
  for (const id of state.expanded)
    if (!byId.has(id)) throw new Error(`Unknown expanded element: ${id}`);
  if (state.scope !== undefined && !byId.has(state.scope))
    throw new Error(`Unknown scope: ${state.scope}`);
  const relationshipIds = new Set<string>();
  const relationshipsById = new Map<string, Relationship>();
  for (const edge of model.relationships) {
    if (relationshipIds.has(edge.id)) throw new Error(`Duplicate relationship: ${edge.id}`);
    relationshipIds.add(edge.id);
    relationshipsById.set(edge.id, edge);
    if (!byId.has(edge.source) || !byId.has(edge.target))
      throw new Error(`Unknown endpoint in relationship: ${edge.id}`);
  }
  for (const boundary of model.boundaries) {
    for (const id of boundary.members)
      if (!byId.has(id)) throw new Error(`Unknown boundary member: ${id}`);
  }
  const expanded = new Set(state.expanded);
  const eligible = (element: Element): boolean => {
    if (!state.proposed && element.status === 'proposed') return false;
    return element.parent === null || eligible(byId.get(element.parent)!);
  };
  if (state.scope !== undefined && !eligible(byId.get(state.scope)!))
    throw new Error(`Scope is hidden by proposal filter: ${state.scope}`);
  const inScope = (element: Element): boolean =>
    state.scope === undefined ||
    element.id === state.scope ||
    (element.parent !== null && inScope(byId.get(element.parent)!));
  const visible = (element: Element): boolean =>
    eligible(element) &&
    inScope(element) &&
    (element.id === state.scope ||
      element.parent === null ||
      (expanded.has(element.parent) && visible(byId.get(element.parent)!)));
  // Re-root the projection only. Authored containment remains intact in the model.
  const elements = model.elements
    .filter(visible)
    .map((element) => (element.id === state.scope ? { ...element, parent: null } : element));
  const visibleIds = new Set(elements.map((element) => element.id));
  const representative = (id: string): string | null => {
    const element = byId.get(id)!;
    if (!eligible(element) || !inScope(element)) return null;
    if (visibleIds.has(id)) return id;
    return element.parent === null ? null : representative(element.parent);
  };
  const summarize = state.edges === 'summary';
  const claims: { edge: Relationship; source: string; target: string }[] = [];
  const outside: Relationship[] = [];
  for (const edge of model.relationships) {
    if (!state.proposed && edge.status === 'proposed') continue;
    const sourceElement = byId.get(edge.source)!;
    const targetElement = byId.get(edge.target)!;
    if (!eligible(sourceElement) || !eligible(targetElement)) continue;
    if (inScope(sourceElement) !== inScope(targetElement)) {
      outside.push({ ...edge });
      continue;
    }
    const source = representative(edge.source);
    const target = representative(edge.target);
    if (!source || !target || (source === target && edge.source !== edge.target)) continue;
    claims.push({ edge, source, target });
  }
  // Summary mode rolls up a pair only where a collapsed representative stands in for an
  // endpoint; a pair of exactly visible elements keeps every distinct claim.
  const pairKey = (source: string, target: string, status: string): string =>
    JSON.stringify([source, target, status]);
  const rolledPairs = new Set(
    summarize
      ? claims
          .filter(({ edge, source, target }) => source !== edge.source || target !== edge.target)
          .map(({ edge, source, target }) => pairKey(source, target, edge.status))
      : []
  );
  const groups = new Map<string, ProjectedEdge>();
  for (const { edge, source, target } of claims) {
    // Different claims stay distinct, even when they roll up to the same endpoints.
    const key = rolledPairs.has(pairKey(source, target, edge.status))
      ? JSON.stringify(['summary', source, target, edge.status])
      : JSON.stringify([
          source,
          target,
          edge.kind,
          edge.status,
          edge.title,
          edge.description,
          edge.layoutFeedback ?? false
        ]);
    const existing = groups.get(key);
    if (existing) existing.underlying.push(edge.id);
    else groups.set(key, { ...edge, source, target, underlying: [edge.id] });
  }
  const edges = [...groups.values()].map((group): ProjectedEdge => {
    // A drawn edge is a feedback edge only when every claim it stands for is one.
    const { layoutFeedback: _first, ...rest } = group;
    const edge: ProjectedEdge = group.underlying.every(
      (id) => relationshipsById.get(id)!.layoutFeedback
    )
      ? { ...rest, layoutFeedback: true }
      : rest;
    if (
      !rolledPairs.has(pairKey(edge.source, edge.target, edge.status)) ||
      edge.underlying.length < 2
    )
      return edge;
    const kinds = new Set(edge.underlying.map((id) => relationshipsById.get(id)!.kind));
    return {
      ...edge,
      kind: kinds.size === 1 ? edge.kind : 'relates',
      title: `${edge.underlying.length} connections`,
      description: `${edge.underlying.length} relationships between ${byId.get(edge.source)?.title} and ${byId.get(edge.target)?.title}.`,
      rollup: true
    };
  });
  return {
    elements,
    edges,
    outside,
    expanded: elements
      .filter(
        (element) =>
          expanded.has(element.id) && elements.some((child) => child.parent === element.id)
      )
      .map((element) => element.id),
    hiddenCount: model.elements.length - elements.length
  };
}

/**
 * Font measurement identical in headless and browser rendering. Slightly conservative for the
 * semibold titles and regular labels the canvas draws, without wrapping half-empty lines.
 */
export function textWidth(text: string, size: number): number {
  return [...text].reduce(
    (width, char) =>
      width +
      size *
        (/\s/.test(char)
          ? 0.34
          : /[ilI.,'`:;!|]/.test(char)
            ? 0.32
            : /[MW@%]/.test(char)
              ? 0.94
              : /[^\u0000-\u024f]/.test(char)
                ? 1.05
                : 0.57),
    0
  );
}

/**
 * Where a long identifier may break without splitting a word: after `_`, `.`, `/` and `-`, and at
 * camelCase boundaries (`requestMoreTools`, `HTTPServer`). Text with none of these is one piece.
 */
export function breakSegments(word: string): string[] {
  const segments: string[] = [];
  let segment = '';
  const chars = [...word];
  chars.forEach((char, index) => {
    segment += char;
    const next = chars[index + 1];
    if (next === undefined) return;
    const after = chars[index + 2];
    const boundary =
      /[_./-]/.test(char) ||
      (/[\p{Ll}\d]/u.test(char) && /\p{Lu}/u.test(next)) ||
      (/\p{Lu}/u.test(char) &&
        /\p{Lu}/u.test(next) &&
        after !== undefined &&
        /\p{Ll}/u.test(after));
    if (boundary) {
      segments.push(segment);
      segment = '';
    }
  });
  if (segment) segments.push(segment);
  return segments;
}

/** The widest piece of text that has no place to break: the floor a title can shrink toward. */
export function longestUnbreakable(text: string, size: number): number {
  return Math.max(
    0,
    ...text
      .split(/\s+/)
      .filter(Boolean)
      .flatMap(breakSegments)
      .map((segment) => textWidth(segment, size))
  );
}

/**
 * Wrap into lines of at most `width`. Words break between words first; a word too long for a line
 * breaks at its own break opportunities, and only a piece that still does not fit is split
 * mid-word.
 */
export function wrapText(text: string, width: number, size: number): string[] {
  if (!text.trim()) return [];
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = '';
    }
    for (const segment of breakSegments(word)) {
      if (line && textWidth(line + segment, size) <= width) {
        line += segment;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      for (const char of segment) {
        if (line && textWidth(line + char, size) > width) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The type size a title draws at: the shared size, shrunk a little (never below two steps) when
 * some piece of it could not otherwise fit the line. Only then does it split inside a word.
 */
export function fitTitleSize(text: string, width: number, size: number): number {
  for (let candidate = size; candidate >= size - 2; candidate--)
    if (longestUnbreakable(text, candidate) <= width) return candidate;
  return size - 2;
}

/** A compact visual label; the full semantic value remains on the model element. */
export function truncateText(text: string, width: number, size: number, letterSpacing = 0): string {
  const measure = (value: string): number =>
    textWidth(value, size) + Math.max(0, [...value].length - 1) * letterSpacing;
  if (measure(text) <= width) return text;
  let result = '';
  for (const character of text) {
    if (measure(result + character + '…') > width) break;
    result += character;
  }
  return result.trimEnd() + '…';
}
