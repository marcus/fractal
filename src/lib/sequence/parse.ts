import { getTheme } from '../core/themes';
import type { Status } from '../core/types';
import type {
  SequenceGroup,
  SequenceJourney,
  SequenceMessage,
  SequenceModel,
  SequenceParticipant,
  SequencePhase,
  SequenceStep
} from './types';

type JsonObject = Record<string, unknown>;
const identityPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const hexColorPattern = /^#[0-9a-f]{6}$/i;

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return value as JsonObject;
}

function keys(value: JsonObject, allowed: readonly string[], path: string): void {
  const supported = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !supported.has(key));
  if (unknown) throw new Error(`${path}.${unknown} is unsupported`);
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function text(value: unknown, path: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${path} must be a non-empty string`);
  return value;
}

function description(value: unknown, path: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  return value;
}

function identity(value: unknown, path: string): string {
  const result = text(value, path);
  if (!identityPattern.test(result))
    throw new Error(`${path} must use letters, numbers, dots, underscores, colons or hyphens`);
  return result;
}

function stableIdentity(value: unknown, path: string): string {
  const result = identity(value, path);
  if (result.startsWith('summary:'))
    throw new Error(`${path} must not use reserved summary: prefix`);
  return result;
}

function unique(ids: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${path} contains duplicate ID ${id}`);
    seen.add(id);
  }
}

function status(value: unknown, path: string): Status {
  if (value === undefined) return 'current';
  if (value !== 'current' && value !== 'proposed')
    throw new Error(`${path} must be current or proposed`);
  return value;
}

function parseStep(
  value: unknown,
  path: string,
  participantIds: Set<string>,
  ids: Set<string>
): SequenceStep {
  const input = object(value, path);
  if (input.type === 'message') {
    keys(input, ['type', 'id', 'title', 'description', 'from', 'to', 'kind'], path);
    const id = stableIdentity(input.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`${path}.id duplicates stable ID ${id}`);
    ids.add(id);
    const from = identity(input.from, `${path}.from`);
    const to = identity(input.to, `${path}.to`);
    if (!participantIds.has(from))
      throw new Error(`${path}.from references unknown participant ${from}`);
    if (!participantIds.has(to)) throw new Error(`${path}.to references unknown participant ${to}`);
    const kind = input.kind ?? 'call';
    if (kind !== 'call' && kind !== 'return' && kind !== 'async')
      throw new Error(`${path}.kind must be call, return or async`);
    return {
      type: 'message',
      id,
      title: text(input.title, `${path}.title`),
      description: description(input.description, `${path}.description`),
      from,
      to,
      kind
    } satisfies SequenceMessage;
  }
  if (input.type === 'phase') {
    keys(input, ['type', 'id', 'title', 'description', 'steps'], path);
    const id = stableIdentity(input.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`${path}.id duplicates stable ID ${id}`);
    ids.add(id);
    const rawSteps = array(input.steps, `${path}.steps`);
    if (!rawSteps.length) throw new Error(`${path}.steps must not be empty`);
    return {
      type: 'phase',
      id,
      title: text(input.title, `${path}.title`),
      description: description(input.description, `${path}.description`),
      steps: rawSteps.map((step, index) =>
        parseStep(step, `${path}.steps[${index}]`, participantIds, ids)
      )
    } satisfies SequencePhase;
  }
  throw new Error(`${path}.type must be message or phase`);
}

function parseJourney(value: unknown, index: number, model: SequenceModel): SequenceJourney {
  const path = `sequences.journeys[${index}]`;
  const input = object(value, path);
  keys(
    input,
    ['id', 'title', 'description', 'provenance', 'status', 'participants', 'groups', 'steps'],
    path
  );
  const journeyStatus = status(input.status, `${path}.status`);
  const elements = new Map(model.elements.map((element) => [element.id, element]));
  const participantInputs = array(input.participants, `${path}.participants`);
  if (!participantInputs.length) throw new Error(`${path}.participants must not be empty`);
  const participants: SequenceParticipant[] = participantInputs.map((value, participantIndex) => {
    const participantPath = `${path}.participants[${participantIndex}]`;
    const participant = object(value, participantPath);
    keys(participant, ['id', 'title', 'element', 'description', 'color'], participantPath);
    const id = stableIdentity(participant.id, `${participantPath}.id`);
    const elementId =
      participant.element === undefined
        ? undefined
        : identity(participant.element, `${participantPath}.element`);
    const element = elementId === undefined ? undefined : elements.get(elementId);
    if (elementId && !element)
      throw new Error(
        `${participantPath}.element references unknown architecture element ${elementId}`
      );
    if (element?.status === 'proposed' && journeyStatus !== 'proposed')
      throw new Error(`${participantPath}.element ${elementId} is proposed but journey is current`);
    const color = participant.color ?? element?.color ?? getTheme().accent;
    if (typeof color !== 'string' || !hexColorPattern.test(color))
      throw new Error(`${participantPath}.color must be a six-digit hex color`);
    return {
      id,
      title: text(participant.title, `${participantPath}.title`, element?.title),
      ...(elementId ? { element: elementId } : {}),
      description:
        participant.description === undefined
          ? (element?.description ?? '')
          : description(participant.description, `${participantPath}.description`),
      color
    };
  });
  unique(
    participants.map(({ id }) => id),
    `${path}.participants`
  );
  const participantIds = new Set(participants.map(({ id }) => id));

  const groups: SequenceGroup[] = array(input.groups ?? [], `${path}.groups`).map(
    (value, groupIndex) => {
      const groupPath = `${path}.groups[${groupIndex}]`;
      const group = object(value, groupPath);
      keys(group, ['id', 'title', 'participants'], groupPath);
      const memberIds = array(group.participants, `${groupPath}.participants`).map(
        (member, memberIndex) => identity(member, `${groupPath}.participants[${memberIndex}]`)
      );
      if (!memberIds.length) throw new Error(`${groupPath}.participants must not be empty`);
      unique(memberIds, `${groupPath}.participants`);
      for (const member of memberIds)
        if (!participantIds.has(member))
          throw new Error(`${groupPath}.participants references unknown participant ${member}`);
      const positions = memberIds.map((member) =>
        participants.findIndex(({ id }) => id === member)
      );
      if (positions.some((position, memberIndex) => position !== positions[0] + memberIndex))
        throw new Error(`${groupPath}.participants must follow contiguous participant order`);
      return {
        id: stableIdentity(group.id, `${groupPath}.id`),
        title: text(group.title, `${groupPath}.title`),
        participants: memberIds
      };
    }
  );
  unique(
    groups.map(({ id }) => id),
    `${path}.groups`
  );
  const grouped = groups.flatMap(({ participants }) => participants);
  unique(grouped, `${path}.groups participant membership`);
  const stableIds = new Set([...participants.map(({ id }) => id), ...groups.map(({ id }) => id)]);
  if (stableIds.size !== participants.length + groups.length)
    throw new Error(`${path} contains duplicate stable IDs across participants and groups`);
  const rawSteps = array(input.steps, `${path}.steps`);
  if (!rawSteps.length) throw new Error(`${path}.steps must not be empty`);
  const steps = rawSteps.map((step, stepIndex) =>
    parseStep(step, `${path}.steps[${stepIndex}]`, participantIds, stableIds)
  );
  return {
    id: stableIdentity(input.id, `${path}.id`),
    title: text(input.title, `${path}.title`),
    description: description(input.description, `${path}.description`),
    provenance: text(input.provenance, `${path}.provenance`),
    status: journeyStatus,
    participants,
    groups,
    steps
  };
}

export function parseSequences(input: unknown, model: SequenceModel): SequenceJourney[] {
  const document = object(input, 'sequences');
  keys(document, ['version', 'journeys'], 'sequences');
  if (document.version !== 1) throw new Error('sequences.version must be 1');
  const journeys = array(document.journeys, 'sequences.journeys').map((journey, index) =>
    parseJourney(journey, index, model)
  );
  unique(
    journeys.map(({ id }) => id),
    'sequences.journeys'
  );
  return journeys;
}
