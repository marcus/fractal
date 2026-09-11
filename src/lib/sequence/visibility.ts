import type { SequenceJourney, SequencePhase, SequenceStep, SequenceViewState } from './types';

export function phaseEntries(journey: SequenceJourney) {
  const result: (SequencePhase & { depth: number; parentId?: string })[] = [];
  function visit(steps: SequenceStep[], depth: number, parentId?: string) {
    for (const step of steps) {
      if (step.type !== 'phase') continue;
      result.push({ ...step, depth, parentId });
      visit(step.steps, depth + 1, step.id);
    }
  }
  visit(journey.steps, 0);
  return result;
}

export function phaseSubtree(journey: SequenceJourney, id: string): string[] {
  const phase = phaseEntries(journey).find((phase) => phase.id === id);
  if (!phase) throw new Error(`Unknown phase: ${id}`);
  return phaseEntries({ ...journey, steps: [phase] }).map((phase) => phase.id);
}

export function visiblePhaseIds(journey: SequenceJourney, view: SequenceViewState): string[] {
  if (view.visiblePhases !== undefined) return view.visiblePhases;
  // Incoming links are validated by layout; keep UI derivation safe until that response arrives.
  if (view.scopePhase)
    return phaseEntries(journey).some((phase) => phase.id === view.scopePhase)
      ? phaseSubtree(journey, view.scopePhase)
      : [];
  return phaseEntries(journey).map((phase) => phase.id);
}

/** Visibility is independent of folding. Parent actions apply to the complete subtree. */
export function setPhaseVisibility(
  journey: SequenceJourney,
  view: SequenceViewState,
  id: string,
  action: 'toggle' | 'only' | 'all'
): SequenceViewState {
  const { scopePhase, visiblePhases, ...rest } = view;
  if (action === 'all') return rest;
  const subtree = phaseSubtree(journey, id);
  if (action === 'only') return { ...rest, visiblePhases: subtree };
  const shown = new Set(visiblePhaseIds(journey, view));
  const hide = subtree.every((id) => shown.has(id));
  for (const member of subtree) hide ? shown.delete(member) : shown.add(member);
  const all = phaseEntries(journey).map((phase) => phase.id);
  return shown.size === all.length
    ? rest
    : { ...rest, visiblePhases: all.filter((id) => shown.has(id)) };
}

/** Retain ancestor headings for context, but only selected phases contribute direct messages. */
export function visibleSteps(journey: SequenceJourney, ids: string[]): SequenceStep[] {
  const shown = new Set(ids);
  function visit(steps: SequenceStep[], includeMessages: boolean): SequenceStep[] {
    return steps.flatMap((step): SequenceStep[] => {
      if (step.type === 'message') return includeMessages ? [step] : [];
      const children = visit(step.steps, shown.has(step.id));
      return shown.has(step.id) || children.length ? [{ ...step, steps: children }] : [];
    });
  }
  return visit(journey.steps, false);
}

/** Show all reveals every phase and unfolds it, matching the Structure outline's Show all. */
export function showAllPhases(
  journey: SequenceJourney,
  view: SequenceViewState
): SequenceViewState {
  const ids = new Set(phaseEntries(journey).map((phase) => phase.id));
  const shown = setPhaseVisibility(journey, view, '', 'all');
  return { ...shown, collapsedPhases: shown.collapsedPhases.filter((id) => !ids.has(id)) };
}

/** A group's members, or the participant itself. */
export function participantMembers(journey: SequenceJourney, id: string): string[] {
  const group = journey.groups.find((group) => group.id === id);
  if (group) return [...group.participants];
  if (!journey.participants.some((participant) => participant.id === id))
    throw new Error(`Unknown participant: ${id}`);
  return [id];
}

/**
 * Participant visibility mirrors phase visibility: toggle a lane or a whole group, isolate one,
 * or restore all. Returns null when the change would leave no lane visible.
 */
export function setParticipantVisibility(
  journey: SequenceJourney,
  view: SequenceViewState,
  id: string,
  action: 'toggle' | 'only' | 'all'
): SequenceViewState | null {
  const all = journey.participants.map((participant) => participant.id);
  if (action === 'all') return { ...view, hiddenParticipants: [] };
  const members = new Set(participantMembers(journey, id));
  const hidden = new Set(view.hiddenParticipants);
  if (action === 'only') {
    hidden.clear();
    for (const participant of all) if (!members.has(participant)) hidden.add(participant);
  } else {
    const hide = [...members].every((member) => !hidden.has(member));
    for (const member of members) hide ? hidden.add(member) : hidden.delete(member);
  }
  if (all.every((participant) => hidden.has(participant))) return null;
  return { ...view, hiddenParticipants: all.filter((participant) => hidden.has(participant)) };
}
