import type { ARCHITECTURE_NODE_METRICS } from './node-metrics';
import type { Element, LayoutEngineId, Point, ProjectedEdge } from './types';

/**
 * The seam between measuring node content and placing it. Measurement is engine-neutral core
 * logic; an engine receives a measured graph and returns placement; core assembles the
 * `Diagram` every renderer consumes and applies the same guarantees to every engine.
 */

export type ArchitectureNodeMetrics = typeof ARCHITECTURE_NODE_METRICS;

/** A visible element with the size its content needs before any placement. */
export interface MeasuredNode extends Element {
  depth: number;
  expanded: boolean;
  width: number;
  height: number;
  /** The title row an expanded container reserves above its children. */
  headerHeight: number;
  titleLines: string[];
  descriptionLines: string[];
  kindLabel: string;
}

/** A projected relationship with the label box it needs reserved. */
export interface MeasuredEdge extends ProjectedEdge {
  labelLines: string[];
  /** Zero when the edge has no label. */
  labelWidth: number;
  labelHeight: number;
}

/** Nodes in depth-first authored order: a parent, then its visible children, then the next sibling. */
export interface MeasuredGraph {
  nodes: MeasuredNode[];
  edges: MeasuredEdge[];
}

/** What a view asks of an engine beyond the graph. Grows only when a second engine needs more. */
export interface LayoutRequest {
  metrics: ArchitectureNodeMetrics;
}

export interface PlacedNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedEdge {
  points: Point[];
  /** Where the label's baseline centre sits; omitted when the engine did not place one. */
  label?: Point;
}

/** Absolute coordinates in one shared diagram space, origin top-left. */
export interface Placement {
  nodes: Record<string, PlacedNode>;
  edges: Record<string, PlacedEdge>;
  width: number;
  height: number;
}

export interface LayoutEngine {
  readonly id: LayoutEngineId;
  readonly title: string;
  readonly description: string;
  layout(graph: MeasuredGraph, request: LayoutRequest): Promise<Placement>;
}
