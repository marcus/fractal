export type Status = 'current' | 'proposed';
export type Lens = 'structure' | 'trust';
export type ThemeId = 'grove' | 'graphite' | 'midnight';
/** Registered layout engines; `core/layout-engines.ts` carries their metadata. */
export type LayoutEngineId = 'elk-layered' | 'elk-layered-down';
export interface Theme {
  readonly id: ThemeId;
  readonly name: string;
  readonly description: string;
  readonly appearance: 'light' | 'dark';
  readonly surface: string;
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
}
export interface Projection {
  elements: Element[];
  edges: ProjectedEdge[];
  expanded: string[];
  hiddenCount: number;
  outside?: Relationship[];
}
export interface Point {
  x: number;
  y: number;
}
export interface LayoutNode extends Element {
  x: number;
  y: number;
  width: number;
  height: number;
  expanded: boolean;
  titleLines: string[];
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
