import type { SequenceColumn, SequenceGap, SequenceJourney, SequenceViewState } from './types';

/** Hidden runs stay anchored to authored order, including the ends and holes within a group. */
export function hiddenLaneGaps(
  journey: SequenceJourney,
  state: SequenceViewState,
  columns: SequenceColumn[]
): SequenceGap[] {
  const hidden = new Set(state.hiddenParticipants);
  const columnFor = new Map(
    columns.flatMap((column) => column.memberIds.map((id) => [id, column] as const))
  );
  const grouped = new Map<string, SequenceGap>();
  for (let index = 0; index < journey.participants.length;) {
    if (!hidden.has(journey.participants[index].id)) {
      index++;
      continue;
    }
    const start = index;
    while (index < journey.participants.length && hidden.has(journey.participants[index].id))
      index++;
    const participants = journey.participants.slice(start, index);
    const left = start > 0 ? columnFor.get(journey.participants[start - 1].id) : undefined;
    const right =
      index < journey.participants.length
        ? columnFor.get(journey.participants[index].id)
        : undefined;
    const inside = left && right && left.id === right.id ? left : undefined;
    const key = JSON.stringify([left?.id, right?.id]);
    const existing = grouped.get(key);
    if (existing) {
      existing.participantIds.push(...participants.map((p) => p.id));
      existing.titles.push(...participants.map((p) => p.title));
      continue;
    }
    // Slash is outside authored ID syntax, so generated UI identities cannot collide.
    grouped.set(key, {
      id: `hidden/${participants[0].id}`,
      participantIds: participants.map((p) => p.id),
      titles: participants.map((p) => p.title),
      ...(left ? { left: left.id } : {}),
      ...(right ? { right: right.id } : {}),
      ...(inside ? { inside: inside.id } : {}),
      x: inside
        ? inside.x
        : left && right
          ? (left.x + left.width / 2 + right.x - right.width / 2) / 2
          : left
            ? left.x + left.width / 2 + 30
            : right!.x - right!.width / 2 - 30,
      y: inside ? inside.y + inside.height + 4 : (left ?? right)!.y + 18,
      width: 32,
      height: 32
    });
  }
  return [...grouped.values()];
}
