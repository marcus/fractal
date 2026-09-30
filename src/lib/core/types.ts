export type Status = 'current' | 'proposed';
export type Lens = 'structure' | 'trust';
export type ThemeId = 'grove' | 'graphite' | 'midnight';
/** Registered layout engines; `core/layout-engines.ts` carries their metadata. */
export type LayoutEngineId = 'elk-layered' | 'elk-layered-down';
/** `ports` (the default for a scoped view) draws outside endpoints as perimeter ports; `none` hides them. */
export type OutsideContext = 'ports' | 'none';
/** `detail` draws every distinct claim; `summary` rolls collapsed connections up into counts. */
export type EdgeDetail = 'detail' | 'summary';
export interface Theme {
  readonly id: ThemeId;
  readonly name: string;
  readonly description: string;
  readonly appearance: 'light' | 'dark';
  readonly surface: string;
  /** Subtle project-frame fill for non-root diagrams in a linked composition. */
  readonly linkedSurface: string;
  readonly canvas: string;
  readonly canvasDots: string;
  readonly card: string;
  readonly group: string;
  readonly text: string;
  readonly muted: string;
  readonly subtitle: string;
  readonly legendText: string;
  readonly subtle: string;
  readonly edge: string;
  readonly border: string;
  readonly divider: string;
  readonly accent: string;
  readonly accentText: string;
  readonly eyebrow: string;
  readonly proposed: string;
  readonly label: string;
  readonly labelText: string;
  readonly shadow: string;
  readonly hover: string;
}
export interface Element {
  id: string;
  sourceId: string;
  parent: string | null;
  title: string;
  kind: string;
  description: string;
  /** Optional short card text from LikeC4 `summary`; the card falls back to `description` and the inspector keeps it whole. */
  summary?: string;
  technology: string;
  status: Status;
  color: string;
  evidence: string[];
}
export interface Relationship {
  id: string;
  source: string;
  target: string;
  title: string;
  kind: string;
  description: string;
  status: Status;
  /**
   * Authored layout hint: this relationship closes a cycle back to an earlier stage, so layout
   * should reverse it rather than any other edge in the loop. It never changes the model's meaning.
   */
  layoutFeedback?: true;
}
export interface Boundary {
  id: string;
  title: string;
  description: string;
  kind: string;
  members: string[];
  color: string;
}
export interface ViewState {
  expanded: string[];
  proposed: boolean;
  lens: Lens;
  scope?: string;
  theme?: ThemeId;
  /** Which engine places the view; absent means the default, so existing links keep their look. */
  layout?: LayoutEngineId;
  /** How collapsed connections draw; absent means `detail`, so existing links keep their look. */
  edges?: EdgeDetail;
  /** How a scoped view shows connections that cross its boundary; absent means `ports`. */
  context?: OutsideContext;
}
export interface Scene extends ViewState {
  id: string;
  title: string;
  description: string;
}
export interface Model {
  version: 1;
  id: string;
  title: string;
  description: string;
  provenance: string;
  elements: Element[];
  relationships: Relationship[];
  boundaries: Boundary[];
  scenes: Scene[];
}
export interface ProjectedEdge extends Relationship {
  underlying: string[];
  /** Set on an edge that stands for several claims rolled up into one counted connection. */
  rollup?: true;
}
/**
 * A visual stand-in for one element outside a scoped view's scope. It is presentation, not model
 * structure: the element it names stays authored where it is, and nothing here is a parent.
 */
export interface ProjectedPort {
  /** Identity of the drawn port, distinct from every authored element ID. */
  id: string;
  /** The outside element the port stands for; selecting the port inspects it. */
  element: string;
  title: string;
  kind: string;
  color: string;
  /** Connections drawn to or from this port, counting every claim rolled into an edge. */
  connections: number;
  /** `in`: the port only supplies the scope; `out`: it only receives from it. */
  flow: 'in' | 'out' | 'both';
}
export interface Projection {
  elements: Element[];
  ports?: ProjectedPort[];
  edges: ProjectedEdge[];
  expanded: string[];
  hiddenCount: number;
  outside?: Relationship[];
}
export interface Point {
  x: number;
  y: number;
}
/** Marks a layout node that draws an outside element as a perimeter port. */
export interface OutsidePort {
  element: string;
  connections: number;
  flow: 'in' | 'out' | 'both';
}
export interface LayoutNode extends Element {
  port?: OutsidePort;
  x: number;
  y: number;
  width: number;
  height: number;
  expanded: boolean;
  titleLines: string[];
  /** Set only when a long identifier shrank to fit; absent means the shared title size. */
  titleSize?: number;
  kindLabel: string;
  descriptionLines: string[];
  depth: number;
}
export interface LayoutEdge extends ProjectedEdge {
  points: Point[];
  label: Point;
  labelLines: string[];
}
export interface Diagram {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  state: ViewState;
  outside?: Relationship[];
}
