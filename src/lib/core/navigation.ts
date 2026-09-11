import type { LayoutNode, Model, ViewState } from './types';
import { project } from './projection';

/** Reveal all eligible descendants without leaving the current scope or enabling proposals. */
export function showAllStructure(model: Model, state: ViewState): ViewState {
  const parents = [...new Set(model.elements.flatMap((e) => (e.parent ? [e.parent] : [])))];
  const visible = project(model, { ...state, expanded: parents }).elements;
  const expandable = new Set(visible.map((e) => e.parent));
  return { ...state, expanded: visible.filter((e) => expandable.has(e.id)).map((e) => e.id) };
}

export type Direction = 'left' | 'right' | 'up' | 'down';
/** Spatial focus is deterministic and prefers the same containment level. */
export function directionalNeighbor(
  nodes: LayoutNode[],
  current: string | null,
  direction: Direction
): string | null {
  if (!nodes.length) return null;
  const start = nodes.find((n) => n.id === current);
  if (!start)
    return (
      [...nodes].filter((n) => !n.parent).sort((a, b) => a.x - b.x || a.y - b.y)[0]?.id ??
      nodes[0].id
    );
  const point = (n: LayoutNode) => ({
    x: n.x + n.width / 2,
    y: n.y + (n.expanded ? 28 : n.height / 2)
  });
  const origin = point(start);
  const ancestor = (id: string, node: LayoutNode): boolean => {
    let parent = node.parent;
    while (parent) {
      if (parent === id) return true;
      parent = nodes.find((n) => n.id === parent)?.parent ?? null;
    }
    return false;
  };
  const candidates = nodes
    .filter((n) => n.id !== current && !ancestor(n.id, start))
    .map((n) => {
      const p = point(n),
        dx = p.x - origin.x,
        dy = p.y - origin.y;
      const forward =
        direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
      const cross = Math.abs(direction === 'left' || direction === 'right' ? dy : dx);
      return { n, forward, cross };
    })
    .filter((c) => c.forward > 1);
  if (!candidates.length) return current;
  const siblings = candidates.filter((c) => c.n.parent === start.parent && c.cross < c.forward * 2);
  const ranked = siblings.length ? siblings : candidates;
  ranked.sort(
    (a, b) => a.forward + a.cross * 2 - (b.forward + b.cross * 2) || a.n.id.localeCompare(b.n.id)
  );
  return ranked[0].n.id;
}

/** Escape changes only the visible level; it never changes the authored model. */
export function outwardView(
  model: Model,
  state: ViewState,
  active: string | null
): { state: ViewState; target: string | null } {
  const element = model.elements.find((e) => e.id === active);
  const within = (id: string, parent: string): boolean => {
    let at: string | null = id;
    while (at) {
      if (at === parent) return true;
      at = model.elements.find((e) => e.id === at)?.parent ?? null;
    }
    return false;
  };
  const collapse = (id: string) => state.expanded.filter((e) => !within(e, id));
  if (state.scope && (!element || element.id === state.scope || element.parent === state.scope)) {
    const previous = model.elements.find((e) => e.id === state.scope)!;
    const parent = previous.parent;
    const expanded = new Set(collapse(previous.id));
    if (parent) expanded.add(parent);
    return {
      state: { ...state, scope: parent ?? undefined, expanded: [...expanded] },
      target: previous.id
    };
  }
  if (element && state.expanded.includes(element.id))
    return { state: { ...state, expanded: collapse(element.id) }, target: element.id };
  if (element?.parent)
    return { state: { ...state, expanded: collapse(element.parent) }, target: element.parent };
  return { state, target: element?.id ?? null };
}
