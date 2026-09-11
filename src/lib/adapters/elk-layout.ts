import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api';
import { project, textWidth, wrapText } from '../core/projection';
import { kindTitle } from '../core/kind-icons';
import { ARCHITECTURE_NODE_METRICS as METRICS } from '../core/node-metrics';
import type { Diagram, LayoutEdge, LayoutNode, Model, ViewState } from '../core/types';

const elk = new ELK();
const options = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.spacing.nodeNode': '32',
  'elk.layered.spacing.nodeNodeBetweenLayers': '48',
  'elk.spacing.edgeNode': '16',
  'elk.spacing.edgeEdge': '18',
  'elk.layered.spacing.edgeNodeBetweenLayers': '16',
  'elk.randomSeed': '1',
  'elk.padding': `[top=${METRICS.containerPadding},left=${METRICS.containerPadding},bottom=${METRICS.containerPadding},right=${METRICS.containerPadding}]`
};

/** ELK owns geometry; the model and projection are independent of its graph schema. */
export async function layout(model: Model, state: ViewState): Promise<Diagram> {
  const projection = project(model, state);
  const expanded = new Set(projection.expanded);
  const nodes = new Map<string, LayoutNode>();
  const byId = new Map(projection.elements.map((element) => [element.id, element]));
  const build = (parent: string | null, depth: number): ElkNode[] =>
    projection.elements
      .filter((element) => element.parent === parent)
      .map((element) => {
        const open = expanded.has(element.id);
        const width = Math.max(
          METRICS.collapsed.minWidth,
          Math.min(METRICS.collapsed.maxWidth, textWidth(element.title, METRICS.titleSize) + 44)
        );
        const titleLines = wrapText(
          element.title,
          width - (open ? METRICS.expandedTitleWidthInset : METRICS.collapsed.titleWidthInset),
          METRICS.titleSize
        );
        const kindLabel = kindTitle(element.kind, element.status);
        const descriptionLines = open
          ? []
          : wrapText(element.description, width - METRICS.collapsed.descriptionWidthInset, 12);
        const header = Math.max(
          METRICS.expandedHeaderMin,
          METRICS.expandedHeaderBase + titleLines.length * METRICS.titleLineHeight
        );
        const height = open
          ? header + METRICS.expandedBodyExtra
          : Math.max(
              METRICS.collapsed.minHeight,
              METRICS.collapsed.heightBase + titleLines.length * 21 + descriptionLines.length * 17
            );
        nodes.set(element.id, {
          ...element,
          x: 0,
          y: 0,
          width,
          height,
          expanded: open,
          titleLines,
          kindLabel,
          descriptionLines,
          depth
        });
        return {
          id: element.id,
          width,
          height,
          layoutOptions: {
            ...options,
            'elk.portConstraints': 'FIXED_SIDE',
            'elk.padding': `[top=${header + METRICS.expandedChildTopGap},left=${METRICS.containerPadding},bottom=${METRICS.containerPadding},right=${METRICS.containerPadding}]`
          },
          ports: [
            {
              id: `${element.id}::in`,
              width: 1,
              height: 1,
              layoutOptions: { 'elk.port.side': 'WEST' }
            },
            {
              id: `${element.id}::out`,
              width: 1,
              height: 1,
              layoutOptions: { 'elk.port.side': 'EAST' }
            }
          ],
          ...(open ? { children: build(element.id, depth + 1) } : {})
        };
      });
  const edges = new Map<string, LayoutEdge>();
  const elkEdges: ElkExtendedEdge[] = projection.edges.map((edge) => {
    const labelLines = wrapText(
      `${edge.title}${edge.underlying.length > 1 ? ` ×${edge.underlying.length}` : ''}`,
      112,
      11
    );
    edges.set(edge.id, { ...edge, points: [], label: { x: 0, y: 0 }, labelLines });
    return {
      id: edge.id,
      sources: [`${edge.source}::out`],
      targets: [`${edge.target}::in`],
      labels: labelLines.length
        ? [
            {
              text: labelLines.join('\n'),
              width: Math.max(...labelLines.map((line) => textWidth(line, 11))) + 14,
              height: labelLines.length * 15 + 10,
              layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' }
            }
          ]
        : []
    };
  });
  const input: ElkNode = {
    id: '__fractal_root__',
    children: build(null, 0),
    edges: [],
    layoutOptions: options
  };
  const containers = new Map<string, ElkNode>();
  const index = (node: ElkNode): void => {
    containers.set(node.id, node);
    node.children?.forEach(index);
  };
  index(input);
  const ancestry = (id: string): string[] => {
    const result: string[] = [];
    let parent = byId.get(id)?.parent;
    while (parent) {
      result.push(parent);
      parent = byId.get(parent)?.parent;
    }
    return result;
  };
  projection.edges.forEach((edge, i) => {
    const targetAncestors = ancestry(edge.target);
    const common = ancestry(edge.source).find((id) => targetAncestors.includes(id));
    const owner = common ? containers.get(common)! : input;
    (owner.edges ??= []).push(elkEdges[i]);
  });
  const graph = await elk.layout<ElkNode>(input);
  const read = (container: ElkNode, offsetX: number, offsetY: number): void => {
    for (const child of container.children ?? []) {
      const node = nodes.get(child.id)!;
      node.x = offsetX + (child.x ?? 0);
      node.y = offsetY + (child.y ?? 0);
      node.width = child.width ?? node.width;
      node.height = child.height ?? node.height;
      if (node.expanded)
        node.titleLines = wrapText(
          node.title,
          node.width - METRICS.expandedTitleWidthInset,
          METRICS.titleSize
        );
      read(child, node.x, node.y);
    }
    for (const edge of container.edges ?? []) {
      const output = edges.get(edge.id);
      if (!output) continue;
      // ELK edge coordinates are relative to their reported containing node.
      const owner = edge.container && nodes.get(edge.container);
      const x = owner ? owner.x : offsetX;
      const y = owner ? owner.y : offsetY;
      output.points = (edge.sections ?? [])
        .flatMap((section) => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint])
        .map((point) => ({ x: point.x + x, y: point.y + y }));
      const label = edge.labels?.[0];
      if (label)
        output.label = {
          x: x + (label.x ?? 0) + (label.width ?? 0) / 2,
          y: y + (label.y ?? 0) + 5 + 11
        };
      else if (output.points.length)
        output.label = output.points[Math.floor(output.points.length / 2)];
    }
  };
  read(graph, 0, 0);
  // Ensure all returned parents are the same authored visible parents (no synthetic boundaries).
  for (const node of nodes.values())
    if (node.parent && !byId.has(node.parent))
      throw new Error(`Missing visible parent: ${node.parent}`);
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    width: graph.width ?? 56,
    height: graph.height ?? 56,
    outside: projection.outside,
    state: { ...state, expanded: [...state.expanded] }
  };
}
