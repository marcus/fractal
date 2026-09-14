import type { LayoutEngineId, Status, ThemeId, ViewState } from '../core/types';

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
