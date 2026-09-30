import type { Boundary, Diagram, Model } from './types';

/** How one boundary shows up in a view: on the exact members drawn, and on collapsed containers. */
export interface BoundaryPresence {
  boundary: Boundary;
  /** Visible nodes that are members themselves. */
  exact: string[];
  /** Visible collapsed nodes that stand in for members drawn inside them. */
  contains: string[];
}

export interface BoundaryView {
  /** Boundaries with at least one member represented in the view, in authored order. */
  present: BoundaryPresence[];
  /** Boundaries no drawn node represents: their members are outside scope or filtered out. */
  omitted: Boundary[];
  /** Per visible node, its boundaries: exact memberships first, then containment. */
  byNode: Map<string, { boundary: Boundary; kind: 'exact' | 'contains' }[]>;
}

/**
 * Resolve boundary membership against what the view draws. A boundary is a claim about elements,
 * not about cards, so a member hidden inside a collapsed parent is still represented by that
 * parent: the parent gets a distinct "contains members" treatment rather than the boundary
 * vanishing. Members outside the scope, or hidden by the proposal filter, represent nothing.
 */
export function boundaryView(model: Model, diagram: Diagram): BoundaryView {
  const byId = new Map(model.elements.map((element) => [element.id, element]));
  const drawn = new Set(diagram.nodes.map((node) => node.id));
  const hidden = (id: string): boolean => {
    for (let current = byId.get(id); current; current = byId.get(current.parent ?? '')) {
      if (current.status === 'proposed' && !diagram.state.proposed) return true;
    }
    return false;
  };
  const present: BoundaryPresence[] = [];
  const omitted: Boundary[] = [];
  const byNode: BoundaryView['byNode'] = new Map();
  const note = (id: string, boundary: Boundary, kind: 'exact' | 'contains'): void => {
    const list = byNode.get(id) ?? [];
    list.push({ boundary, kind });
    byNode.set(id, list);
  };
  const entries: BoundaryPresence[] = [];
  for (const boundary of model.boundaries) {
    const exact = new Set<string>();
    const contains = new Set<string>();
    for (const member of boundary.members) {
      if (!byId.has(member) || hidden(member)) continue;
      if (drawn.has(member)) {
        exact.add(member);
        continue;
      }
      for (let up = byId.get(member)?.parent; up; up = byId.get(up)?.parent) {
        if (drawn.has(up)) {
          contains.add(up);
          break;
        }
      }
    }
    const entry = {
      boundary,
      exact: [...exact],
      contains: [...contains].filter((id) => !exact.has(id))
    };
    if (entry.exact.length || entry.contains.length) present.push(entry);
    else omitted.push(boundary);
    entries.push(entry);
  }
  // Exact memberships sort ahead of containment on a node, each in authored order.
  for (const kind of ['exact', 'contains'] as const)
    for (const entry of entries) for (const id of entry[kind]) note(id, entry.boundary, kind);
  return { present, omitted, byNode };
}
