import type { Model, ThemeId, Status } from '../core/types';

export interface SequenceParticipant {
  id: string;
  title: string;
  element?: string;
  description: string;
  color: string;
}
export interface SequenceGroup {
  id: string;
  title: string;
  participants: string[];
}
export interface SequenceMessage {
  type: 'message';
  id: string;
  title: string;
  description: string;
  from: string;
  to: string;
  kind: 'call' | 'return' | 'async';
}
export interface SequencePhase {
  type: 'phase';
  id: string;
  title: string;
  description: string;
  steps: SequenceStep[];
}
export type SequenceStep = SequenceMessage | SequencePhase;
export interface SequenceJourney {
  id: string;
  title: string;
  description: string;
  provenance: string;
  status: Status;
  participants: SequenceParticipant[];
  groups: SequenceGroup[];
  steps: SequenceStep[];
}
export interface SequenceViewState {
  collapsedPhases: string[];
  collapsedGroups: string[];
  hiddenParticipants: string[];
  scopePhase?: string;
  /** Exact phase selection; absent means all, empty means none. Ancestors remain as context. */
  visiblePhases?: string[];
  theme?: ThemeId;
}
export interface SequenceColumn {
  id: string;
  title: string;
  titleLines: string[];
  color: string;
  memberIds: string[];
  elementIds: string[];
  /** Horizontal center of the participant header and lifeline. */
  x: number;
  /** Top edge of the participant header. */
  y: number;
  width: number;
  /** Measured participant header height, including every wrapped title line. */
  height: number;
}
export interface SequenceGap {
  id: string;
  participantIds: string[];
  titles: string[];
  left?: string;
  right?: string;
  inside?: string;
  /** Header marker center and top, in the shared diagram coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SequenceRow {
  id: string;
  type: 'phase' | 'message' | 'internal' | 'hidden';
  title: string;
  titleLines: string[];
  description: string;
  descriptionLines: string[];
  depth: number;
  parent?: string;
  y: number;
  height: number;
  x: number;
  width: number;
  titleX: number;
  countX: number;
  /** Shared absolute baselines for browser and export renderers. */
  titleY: number;
  descriptionY?: number;
  /**
   * Set only when a one-line title and its one-line subtitle share a baseline, so a long
   * journey stays readable without a second line per row. Both are horizontal offsets from
   * the anchor the renderer already uses for the row (`titleX` for phases, the label centre
   * for every other row), leaving the anchor itself animatable.
   */
  titleDx?: number;
  descriptionDx?: number;
  arrowY?: number;
  from?: string;
  to?: string;
  kind?: SequenceMessage['kind'];
  messageIds: string[];
  hiddenMessageIds: string[];
  participantIds: string[];
  collapsed?: boolean;
  contextOnly?: boolean;
}
export interface SequenceDiagram {
  journeyId: string;
  columns: SequenceColumn[];
  gaps: SequenceGap[];
  rows: SequenceRow[];
  width: number;
  height: number;
  state: SequenceViewState;
  totalMessages: number;
  hiddenMessages: number;
}
export type SequenceModel = Pick<Model, 'elements'>;
