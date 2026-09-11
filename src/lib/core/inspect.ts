import { project } from './projection';
import type { Model, ViewState } from './types';

/** Full element identity with view-eligible children/connections, shared by UI and CLI. */
export function inspectComponent(model: Model, id: string, view: Pick<ViewState, 'proposed'>) {
  const element = model.elements.find((entry) => entry.id === id);
  if (!element) throw new Error(`Unknown element: ${id}`);
  const parents = [
    ...new Set(model.elements.flatMap((entry) => (entry.parent ? [entry.parent] : [])))
  ];
  const visible = project(model, { expanded: parents, proposed: view.proposed, lens: 'structure' });
  const visibleIds = new Set(visible.elements.map((entry) => entry.id));
  return {
    element,
    children: model.elements.filter((entry) => entry.parent === id && visibleIds.has(entry.id)),
    relationships: model.relationships.filter(
      (relation) =>
        (relation.source === id || relation.target === id) &&
        (view.proposed || relation.status === 'current') &&
        visibleIds.has(relation.source) &&
        visibleIds.has(relation.target)
    ),
    boundaries: model.boundaries.filter((boundary) => boundary.members.includes(id))
  };
}
