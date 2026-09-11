import { textWidth, wrapText } from '../core/projection';
import { getTheme } from '../core/themes';
import { hiddenLaneGaps } from './gaps';
import { visibleSteps } from './visibility';
import { participantHeaderHeight, SELF_MESSAGE_LOOP_HEIGHT } from './metrics';
import type {
  SequenceColumn,
  SequenceDiagram,
  SequenceJourney,
  SequenceMessage,
  SequencePhase,
  SequenceRow,
  SequenceStep,
  SequenceViewState
} from './types';

const columnTop = 32;
const rowGap = 14;
const sideMargin = 80;
/** Breathing room between a title and the subtitle that shares its baseline. */
const inlineGap = 14;
/**
 * `textWidth` averages glyph widths, so a caps-heavy title can measure short of what a
 * browser or Arial actually draws. On a phase band the gap is the only thing keeping the
 * two apart, so allow for that error before the subtitle starts.
 */
const inlineTolerance = 0.1;
/** Text budgets inside the fixed label plates both renderers draw. */
const messageLabelWidth = 330;
const hiddenLabelWidth = 640;

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${path} contains duplicate IDs`);
}

function messages(step: SequenceStep): SequenceMessage[] {
  return step.type === 'message' ? [step] : step.steps.flatMap(messages);
}

function phases(steps: readonly SequenceStep[]): SequencePhase[] {
  return steps.flatMap((step) => (step.type === 'message' ? [] : [step, ...phases(step.steps)]));
}

function effectiveState(journey: SequenceJourney, state?: SequenceViewState): SequenceViewState {
  if (state !== undefined && (!state || typeof state !== 'object' || Array.isArray(state)))
    throw new Error('state must be an object');
  const input = (state ?? {}) as Record<string, unknown>;
  const allowed = new Set([
    'collapsedPhases',
    'collapsedGroups',
    'hiddenParticipants',
    'scopePhase',
    'visiblePhases',
    'theme'
  ]);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`state.${unknown} is unsupported`);
  const strings = (value: unknown, path: string): string[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim()))
      throw new Error(`${path} must be an array of non-empty strings`);
    return [...value] as string[];
  };
  if (
    input.scopePhase !== undefined &&
    (typeof input.scopePhase !== 'string' || !input.scopePhase.trim())
  )
    throw new Error('state.scopePhase must be a non-empty string');
  if (input.theme !== undefined && (typeof input.theme !== 'string' || !input.theme.trim()))
    throw new Error('state.theme must be a non-empty string');
  const result: SequenceViewState = {
    collapsedPhases: strings(input.collapsedPhases, 'state.collapsedPhases'),
    collapsedGroups: strings(input.collapsedGroups, 'state.collapsedGroups'),
    hiddenParticipants: strings(input.hiddenParticipants, 'state.hiddenParticipants'),
    ...(input.visiblePhases !== undefined
      ? { visiblePhases: strings(input.visiblePhases, 'state.visiblePhases') }
      : {}),
    ...(input.scopePhase !== undefined ? { scopePhase: input.scopePhase as string } : {}),
    theme: (input.theme as SequenceViewState['theme'] | undefined) ?? 'grove'
  };
  getTheme(result.theme);
  unique(result.collapsedPhases, 'state.collapsedPhases');
  unique(result.collapsedGroups, 'state.collapsedGroups');
  unique(result.hiddenParticipants, 'state.hiddenParticipants');
  unique(result.visiblePhases ?? [], 'state.visiblePhases');
  if (result.scopePhase && result.visiblePhases !== undefined)
    throw new Error('Use either state.scopePhase or state.visiblePhases, not both');
  const phaseIds = new Set(phases(journey.steps).map(({ id }) => id));
  const groupIds = new Set(journey.groups.map(({ id }) => id));
  const participantIds = new Set(journey.participants.map(({ id }) => id));
  for (const id of result.visiblePhases ?? [])
    if (!phaseIds.has(id)) throw new Error(`state.visiblePhases references unknown phase ${id}`);
  for (const id of result.collapsedPhases)
    if (!phaseIds.has(id)) throw new Error(`state.collapsedPhases references unknown phase ${id}`);
  for (const id of result.collapsedGroups)
    if (!groupIds.has(id)) throw new Error(`state.collapsedGroups references unknown group ${id}`);
  for (const id of result.hiddenParticipants)
    if (!participantIds.has(id))
      throw new Error(`state.hiddenParticipants references unknown participant ${id}`);
  if (result.scopePhase && !phaseIds.has(result.scopePhase))
    throw new Error(`state.scopePhase references unknown phase ${result.scopePhase}`);
  if (result.hiddenParticipants.length === journey.participants.length)
    throw new Error('state.hiddenParticipants cannot hide all participants');
  return result;
}

function scopedSteps(journey: SequenceJourney, scope?: string): SequenceStep[] {
  if (!scope) return journey.steps;
  const phase = phases(journey.steps).find(({ id }) => id === scope)!;
  return [phase];
}

function buildColumns(
  journey: SequenceJourney,
  state: SequenceViewState
): { columns: SequenceColumn[]; width: number; headerHeight: number } {
  const hidden = new Set(state.hiddenParticipants);
  const collapsed = new Set(state.collapsedGroups);
  const groupByParticipant = new Map<string, (typeof journey.groups)[number]>();
  for (const group of journey.groups)
    if (collapsed.has(group.id))
      for (const participant of group.participants) groupByParticipant.set(participant, group);
  const drafts: Omit<SequenceColumn, 'x' | 'y' | 'width' | 'height' | 'titleLines'>[] = [];
  const emitted = new Set<string>();
  for (const participant of journey.participants) {
    if (hidden.has(participant.id)) continue;
    const group = groupByParticipant.get(participant.id);
    if (group) {
      if (emitted.has(group.id)) continue;
      emitted.add(group.id);
      const visibleMembers = group.participants.filter((id) => !hidden.has(id));
      if (!visibleMembers.length) continue;
      drafts.push({
        id: group.id,
        title: group.title,
        color: journey.participants.find(({ id }) => id === visibleMembers[0])!.color,
        memberIds: visibleMembers,
        elementIds: visibleMembers.flatMap((id) => {
          const element = journey.participants.find(
            (participant) => participant.id === id
          )!.element;
          return element ? [element] : [];
        })
      });
      continue;
    }
    drafts.push({
      id: participant.id,
      title: participant.title,
      color: participant.color,
      memberIds: [participant.id],
      elementIds: participant.element ? [participant.element] : []
    });
  }
  if (!drafts.length) throw new Error('sequence projection must retain at least one column');
  const slot = Math.max(204, Math.min(288, (1920 - sideMargin * 2) / drafts.length));
  const width = slot - 44;
  const diagramWidth = Math.max(960, sideMargin * 2 + slot * drafts.length);
  const firstSlot = (diagramWidth - slot * drafts.length) / 2;
  const measured = drafts.map((column, index) => {
    const titleLines = wrapText(column.title, width - 24, 15);
    return {
      ...column,
      titleLines,
      x: firstSlot + slot * index + slot / 2,
      y: columnTop,
      width,
      height: participantHeaderHeight(titleLines.length)
    };
  });
  const headerHeight = Math.max(...measured.map(({ height }) => height));
  const columns = measured.map((column) => ({ ...column, height: headerHeight }));
  return { columns, width: diagramWidth, headerHeight };
}

function rowHeight(
  titleLines: readonly string[],
  descriptionLines: readonly string[],
  type: SequenceRow['type']
): number {
  const contentBottom = descriptionLines.length
    ? 23 + titleLines.length * 19 + 3 + (descriptionLines.length - 1) * 15 + 6
    : 23 + (titleLines.length - 1) * 19 + 7;
  if (type === 'phase') return Math.max(34, contentBottom + 5);
  if (type === 'message') return Math.max(50, contentBottom + 16);
  return Math.max(42, contentBottom + 7);
}

/**
 * A single-line title and subtitle share one baseline when both fit the row's text budget,
 * so an expanded journey stays as compact as a hand-drawn sequence chart. The returned
 * offsets are relative to the anchor each renderer already uses: phases start at `titleX`,
 * every other row centres on its label.
 */
function inlineBaseline(
  titleLines: readonly string[],
  descriptionLines: readonly string[],
  type: SequenceRow['type'],
  maxWidth: number
): { titleDx: number; descriptionDx: number } | null {
  if (titleLines.length !== 1 || descriptionLines.length !== 1) return null;
  const title = textWidth(titleLines[0], type === 'phase' ? 15 : 13);
  const description = textWidth(descriptionLines[0], 11);
  const separation = inlineGap + title * inlineTolerance;
  const total = title + separation + description;
  if (total > maxWidth) return null;
  if (type === 'phase') return { titleDx: 0, descriptionDx: title + separation };
  return { titleDx: (title - total) / 2, descriptionDx: (total - description) / 2 };
}

export function layoutSequence(
  journey: SequenceJourney,
  requested?: SequenceViewState
): SequenceDiagram {
  const state = effectiveState(journey, requested);
  const { columns, width, headerHeight } = buildColumns(journey, state);
  const columnFor = new Map<string, string>();
  for (const column of columns)
    for (const member of column.memberIds) columnFor.set(member, column.id);
  const hidden = new Set(state.hiddenParticipants);
  const collapsedPhases = new Set(state.collapsedPhases);
  const projectedSteps =
    state.visiblePhases !== undefined
      ? visibleSteps(journey, state.visiblePhases)
      : scopedSteps(journey, state.scopePhase);
  const hiddenMessageIds = new Set(
    projectedSteps
      .flatMap(messages)
      .filter((message) => hidden.has(message.from) || hidden.has(message.to))
      .map((message) => message.id)
  );
  const rows: SequenceRow[] = [];
  let pendingInternal: { message: SequenceMessage; depth: number; parent?: string }[] = [];

  const addRow = (
    row: Omit<
      SequenceRow,
      | 'y'
      | 'height'
      | 'titleLines'
      | 'descriptionLines'
      | 'titleY'
      | 'descriptionY'
      | 'arrowY'
      | 'x'
      | 'width'
      | 'titleX'
      | 'countX'
      | 'hiddenMessageIds'
    >,
    maxWidth = 700
  ) => {
    const titleLines = wrapText(row.title, maxWidth, row.type === 'phase' ? 15 : 13);
    const descriptionLines = row.description ? wrapText(row.description, maxWidth, 11) : [];
    const inline = inlineBaseline(titleLines, descriptionLines, row.type, maxWidth);
    rows.push({
      ...row,
      hiddenMessageIds: row.messageIds.filter((id) => hiddenMessageIds.has(id)),
      titleLines,
      descriptionLines,
      ...(inline ?? {}),
      y: 0,
      // The return loop starts above arrowY; reserve its height below the measured label.
      height:
        rowHeight(titleLines, inline ? [] : descriptionLines, row.type) +
        (row.type === 'message' && row.from === row.to ? SELF_MESSAGE_LOOP_HEIGHT : 0),
      titleY: 0,
      x: 58,
      width: width - 116,
      titleX: 78,
      countX: width - 100
    });
  };
  const flushInternal = () => {
    if (!pendingInternal.length) return;
    const first = pendingInternal[0];
    const column = columnFor.get(first.message.from)!;
    const titles = pendingInternal.map(({ message }) => message.title);
    addRow(
      {
        id: `summary:${first.message.id}`,
        type: 'internal',
        title:
          pendingInternal.length === 1
            ? first.message.title
            : `${pendingInternal.length} internal interactions`,
        description: pendingInternal.length === 1 ? first.message.description : titles.join(' · '),
        depth: first.depth,
        ...(first.parent ? { parent: first.parent } : {}),
        from: column,
        to: column,
        messageIds: pendingInternal.map(({ message }) => message.id),
        participantIds: [
          ...new Set(pendingInternal.flatMap(({ message }) => [message.from, message.to]))
        ]
      },
      Math.max(80, columns.find(({ id }) => id === column)!.width - 20)
    );
    pendingInternal = [];
  };
  const visit = (steps: readonly SequenceStep[], depth: number, parent?: string) => {
    for (const step of steps) {
      if (step.type === 'phase') {
        flushInternal();
        const contained = messages(step);
        const contextOnly =
          state.visiblePhases !== undefined && !state.visiblePhases.includes(step.id);
        addRow(
          {
            id: step.id,
            type: 'phase',
            title: step.title,
            description: contextOnly ? '' : step.description,
            depth,
            ...(parent ? { parent } : {}),
            messageIds: contained.map(({ id }) => id),
            participantIds: [...new Set(contained.flatMap(({ from, to }) => [from, to]))],
            contextOnly,
            collapsed: !contextOnly && collapsedPhases.has(step.id)
          },
          Math.max(240, width - 430)
        );
        if (contextOnly || !collapsedPhases.has(step.id)) visit(step.steps, depth + 1, step.id);
        flushInternal();
        continue;
      }
      const participantIds = [step.from, step.to];
      if (hidden.has(step.from) || hidden.has(step.to)) {
        flushInternal();
        addRow(
          {
            id: step.id,
            type: 'hidden',
            title: `Omitted interaction: ${step.title}`,
            description: step.description,
            depth,
            ...(parent ? { parent } : {}),
            kind: step.kind,
            messageIds: [step.id],
            participantIds
          },
          hiddenLabelWidth
        );
        continue;
      }
      const from = columnFor.get(step.from)!;
      const to = columnFor.get(step.to)!;
      if (from === to && from !== step.from) {
        if (pendingInternal.length && columnFor.get(pendingInternal[0].message.from) !== from)
          flushInternal();
        pendingInternal.push({ message: step, depth, ...(parent ? { parent } : {}) });
        continue;
      }
      flushInternal();
      addRow(
        {
          id: step.id,
          type: 'message',
          title: step.title,
          description: step.description,
          depth,
          ...(parent ? { parent } : {}),
          from,
          to,
          kind: step.kind,
          messageIds: [step.id],
          participantIds
        },
        // Both renderers draw a 360-wide label plate, so wrap to it rather than to the lane
        // gap: a short hop between neighbours costs no extra lines it does not need.
        messageLabelWidth
      );
    }
    flushInternal();
  };
  visit(projectedSteps, 0);
  let y = columnTop + headerHeight + 42;
  for (const row of rows) {
    row.y = y;
    row.titleY = y + 23;
    if (row.descriptionLines.length)
      row.descriptionY =
        row.descriptionDx === undefined ? row.titleY + row.titleLines.length * 19 + 3 : row.titleY;
    if (row.type === 'message') row.arrowY = y + row.height - 11;
    y += row.height + rowGap;
  }
  return {
    journeyId: journey.id,
    columns,
    gaps: hiddenLaneGaps(journey, state, columns),
    rows,
    width,
    height: Math.max(300, y + 50),
    state,
    totalMessages: journey.steps.flatMap(messages).length,
    hiddenMessages: hiddenMessageIds.size
  };
}

/** Restore authored lanes and separate their groups so the result is visible in the chart. */
export function revealHiddenLanes(
  journey: SequenceJourney,
  view: SequenceViewState,
  ids: readonly string[]
): SequenceViewState {
  const state = effectiveState(journey, view);
  const restored = new Set(ids);
  if (ids.some((id) => !state.hiddenParticipants.includes(id)))
    throw new Error('Only hidden participants can be restored');
  return {
    ...state,
    hiddenParticipants: state.hiddenParticipants.filter((id) => !restored.has(id)),
    collapsedGroups: state.collapsedGroups.filter(
      (id) =>
        !journey.groups
          .find((group) => group.id === id)!
          .participants.some((member) => restored.has(member))
    )
  };
}
