import { getLayoutEngine } from '../adapters/layout';
import { measure } from './measure';
import { ARCHITECTURE_NODE_METRICS as METRICS } from './node-metrics';
import { project, wrapText } from './projection';
import type { LayoutEngine, MeasuredGraph, Placement } from './layout-engine';
import type { Diagram, LayoutEdge, LayoutNode, Model, Projection, ViewState } from './types';

/**
 * Turn an engine's placement back into the diagram every renderer consumes. Titles of expanded
 * containers wrap again to the width the engine gave them, and every visible parent must be a
 * visible authored element: engines place, they never invent structure.
 */
export function assembleDiagram(
  projection: Projection,
  graph: MeasuredGraph,
  placement: Placement,
  state: ViewState
): Diagram {
  const visible = new Set(projection.elements.map((element) => element.id));
  const nodes: LayoutNode[] = graph.nodes.map((node) => {
    const placed = placement.nodes[node.id];
    const width = placed?.width ?? node.width;
    const {
      depth,
      expanded,
      width: _measuredWidth,
      height: measuredHeight,
      headerHeight: _header,
      titleLines,
      descriptionLines,
      kindLabel,
      ...element
    } = node;
    return {
      ...element,
      x: placed?.x ?? 0,
      y: placed?.y ?? 0,
      width,
      height: placed?.height ?? measuredHeight,
      expanded,
      titleLines: expanded
        ? wrapText(node.title, width - METRICS.expandedTitleWidthInset, METRICS.titleSize)
        : titleLines,
      kindLabel,
      descriptionLines,
      depth
    };
  });
  for (const node of nodes)
    if (node.parent && !visible.has(node.parent))
      throw new Error(`Missing visible parent: ${node.parent}`);
  const edges: LayoutEdge[] = graph.edges.map((edge) => {
    const placed = placement.edges[edge.id];
    const points = placed?.points ?? [];
    const { labelLines, labelWidth: _width, labelHeight: _height, ...projected } = edge;
    return {
      ...projected,
      points,
      label:
        placed?.label ?? (points.length ? points[Math.floor(points.length / 2)] : { x: 0, y: 0 }),
      labelLines
    };
  });
  return {
    nodes,
    edges,
    width: placement.width,
    height: placement.height,
    outside: projection.outside,
    state: { ...state, expanded: [...state.expanded] }
  };
}

/**
 * Project, measure, place and assemble. The engine comes from the view state's `layout` field
 * through the registry unless a caller supplies one directly (benchmarks compare engines that way).
 */
export async function layout(
  model: Model,
  state: ViewState,
  engine: LayoutEngine = getLayoutEngine(state.layout)
): Promise<Diagram> {
  const projection = project(model, state);
  const graph = measure(projection);
  const placement = await engine.layout(graph, { metrics: METRICS });
  return assembleDiagram(projection, graph, placement, state);
}
