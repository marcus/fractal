import { revealSearchResult } from './search';
import type { Model, ViewState } from './types';

/** A direct link to an omitted identity reveals its path, without resetting unrelated omissions. */
export function revealHiddenSelection(model: Model, view: ViewState, id: string): ViewState {
  if (!view.hide?.length) return view;
  const element = model.elements.find((item) => item.id === id);
  const relationship = model.relationships.find((item) => item.id === id);
  const item = element ?? relationship;
  if (!item) return view;
  const revealed = revealSearchResult(model, view, {
    id,
    type: element ? 'element' : 'relationship',
    title: item.title,
    description: item.description
  }).view;
  // Ordinary collapsed selections retain their existing permalink behavior.
  return (revealed.hide?.length ?? 0) < view.hide.length ? revealed : view;
}
