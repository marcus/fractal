import type { Diagram, LayoutEngineId, Point, Status, ThemeId, ViewState } from '../core/types';

/** Phase 0 contracts; no loader, route, CLI or renderer consumes these yet. */
export interface ElementReference {
  model: string;
  element: string;
}
export interface DiagramLink {
  id: string;
  from?: string;
  target: { model: string; scene?: string };
  title: string;
}
export interface ProjectConnection {
  id: string;
  source: ElementReference;
  target: ElementReference;
  title: string;
  kind: string;
  status: Status;
  description: string;
  /** Inert paths relative to the authoring repository. */
  evidence: string[];
}
export interface AuthoredComposition {
  id: string;
  title: string;
  rootScene?: string;
  /** Linked projects only; the authoring root is implicitly first and open. */
  projects: { model: string; scene?: string; mode: 'open' | 'collapsed' }[];
}
export interface ProjectLinks {
  version: 1;
  links: DiagramLink[];
  connections: ProjectConnection[];
  compositions: AuthoredComposition[];
}
export type QualifiedSelection =
  | { kind: 'project'; model: string }
  | { kind: 'element'; model: string; element: string }
  | { kind: 'relationship'; model: string; relationship: string }
  | { kind: 'boundary'; model: string; boundary: string }
  | { kind: 'scene'; model: string; scene: string }
  | { kind: 'connection'; ownerModel: string; connectionId: string };

/** Shared theme/direction own presentation; project records retain semantic local view state. */
export type ProjectViewState = Pick<ViewState, 'expanded' | 'proposed' | 'lens' | 'scope'>;
export interface CompositionState {
  version: 1;
  root: string;
  composition?: string;
  projects: {
    model: string;
    scene?: string;
    mode: 'open' | 'collapsed';
    view: ProjectViewState;
  }[];
  theme: ThemeId;
  layout: LayoutEngineId;
  selection?: QualifiedSelection;
  focusedProject?: string;
}

/** Contract for future adapters, not a claim that current LikeC4 snapshots preserve this. */
export interface IdentityOrigins {
  elements: Record<string, 'explicit' | 'fallback'>;
  relationships: Record<string, 'explicit' | 'fallback'>;
}
export type CompositionDiagnosticCode =
  | 'model_unavailable'
  | 'model_invalid'
  | 'unsupported_version'
  | 'scene_missing'
  | 'endpoint_missing'
  | 'identity_not_explicit'
  | 'revision_changed'
  | 'source_changing'
  | 'budget_exceeded';
export interface CompositionDiagnostic {
  code: CompositionDiagnosticCode;
  ownerModel: string;
  message: string;
  path?: string;
  linkId?: string;
  connectionId?: string;
  target?: { model: string; element?: string; scene?: string };
  recovery: 'register' | 'retry' | 'repair' | 'upgrade' | 'reload' | 'reduce';
  budget?: { resource: string; actual: number; limit: number };
}

/** Phase 1 composed output. Frame/content coordinates are in one shared composed space. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ComposedProject {
  model: string;
  title: string;
  mode: 'open' | 'collapsed';
  revision: string;
  scene?: string;
  /** Outer rectangle in composed coordinates, including the title band. */
  frame: Frame;
  titleLines: string[];
  titleHeight: number;
  /** Where the local diagram's (0,0) lands; null-size when collapsed. */
  content: Frame;
  diagram: Diagram | null;
}
/** A visible stand-in for an authored endpoint: a node, the whole project, or a perimeter port. */
export type BridgeRepresentative =
  | { kind: 'node'; id: string }
  | { kind: 'project' }
  | { kind: 'port'; reason: 'outside-scope' | 'hidden' };
export interface BridgeEndpoint {
  model: string;
  element: string;
  representative: BridgeRepresentative;
  /** Composed coordinates on the representative's edge. */
  point: Point;
}
export interface ComposedBridge extends Omit<ProjectConnection, 'source' | 'target'> {
  owner: string;
  source: BridgeEndpoint;
  target: BridgeEndpoint;
  points: Point[];
  label: Point;
  labelLines: string[];
}
export interface ReferenceStub {
  owner: string;
  linkId?: string;
  connectionId?: string;
  anchor: { model: string; element?: string };
  target: { model: string; element?: string; scene?: string };
  state: 'not_loaded' | 'unavailable' | 'invalid';
  title: string;
}
export interface ComposedDiagram {
  state: CompositionState;
  projects: ComposedProject[];
  bridges: ComposedBridge[];
  stubs: ReferenceStub[];
  diagnostics: CompositionDiagnostic[];
  width: number;
  height: number;
}
