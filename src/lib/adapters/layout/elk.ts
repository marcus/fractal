import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api';
import type {
  LayoutEngine,
  LayoutRequest,
  MeasuredGraph,
  MeasuredNode,
  Placement
} from '../../core/layout-engine';
import type { LayoutEngineId } from '../../core/types';

/** How the flow runs and which node sides connections leave from and arrive at. */
export interface ElkLayeredOptions {
  id: LayoutEngineId;
  title: string;
  description: string;
  direction: 'right' | 'down';
}

const elk = new ELK();

/**
 * ELK layered placement. ELK owns geometry; the measured graph and the diagram are independent
 * of its graph schema, so this file is the only place that knows about ports, hierarchy handling
 * or ELK's relative coordinates.
 */
export function elkLayeredEngine(options: ElkLayeredOptions): LayoutEngine {
  const down = options.direction === 'down';
  return {
    id: options.id,
    title: options.title,
    description: options.description,
    async layout(graph: MeasuredGraph, request: LayoutRequest): Promise<Placement> {
      const padding = request.metrics.containerPadding;
      const base = {
        'elk.algorithm': 'layered',
        'elk.direction': down ? 'DOWN' : 'RIGHT',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.spacing.nodeNode': '32',
        'elk.layered.spacing.nodeNodeBetweenLayers': '48',
        'elk.spacing.edgeNode': '16',
        'elk.spacing.edgeEdge': '18',
        'elk.layered.spacing.edgeNodeBetweenLayers': '16',
        'elk.randomSeed': '1',
        'elk.padding': `[top=${padding},left=${padding},bottom=${padding},right=${padding}]`
      };
      const byParent = new Map<string | null, MeasuredNode[]>();
      for (const node of graph.nodes) {
        const siblings = byParent.get(node.parent) ?? [];
        siblings.push(node);
        byParent.set(node.parent, siblings);
      }
      const parents = new Map(graph.nodes.map((node) => [node.id, node.parent]));
      const build = (parent: string | null): ElkNode[] =>
        (byParent.get(parent) ?? []).map((node) => ({
          id: node.id,
          width: node.width,
          height: node.height,
          layoutOptions: {
            ...base,
            'elk.portConstraints': 'FIXED_SIDE',
            'elk.padding': `[top=${node.headerHeight + request.metrics.expandedChildTopGap},left=${padding},bottom=${padding},right=${padding}]`
          },
          ports: [
            {
              id: `${node.id}::in`,
              width: 1,
              height: 1,
              layoutOptions: { 'elk.port.side': down ? 'NORTH' : 'WEST' }
            },
            {
              id: `${node.id}::out`,
              width: 1,
              height: 1,
              layoutOptions: { 'elk.port.side': down ? 'SOUTH' : 'EAST' }
            }
          ],
          ...(node.expanded ? { children: build(node.id) } : {})
        }));
      const input: ElkNode = {
        id: '__fractal_root__',
        children: build(null),
        edges: [],
        layoutOptions: base
      };
      const containers = new Map<string, ElkNode>();
      const index = (node: ElkNode): void => {
        containers.set(node.id, node);
        node.children?.forEach(index);
      };
      index(input);
      const ancestry = (id: string): string[] => {
        const result: string[] = [];
        let parent = parents.get(id) ?? null;
        while (parent) {
          result.push(parent);
          parent = parents.get(parent) ?? null;
        }
        return result;
      };
      for (const edge of graph.edges) {
        const elkEdge: ElkExtendedEdge = {
          id: edge.id,
          sources: [`${edge.source}::out`],
          targets: [`${edge.target}::in`],
          labels: edge.labelLines.length
            ? [
                {
                  text: edge.labelLines.join('\n'),
                  width: edge.labelWidth,
                  height: edge.labelHeight,
                  layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' }
                }
              ]
            : []
        };
        // An edge belongs to the innermost container holding both ends, or the root.
        const targetAncestors = ancestry(edge.target);
        const common = ancestry(edge.source).find((id) => targetAncestors.includes(id));
        const owner = common ? containers.get(common)! : input;
        (owner.edges ??= []).push(elkEdge);
      }
      const result = await elk.layout<ElkNode>(input);
      const placement: Placement = {
        nodes: {},
        edges: {},
        width: result.width ?? 56,
        height: result.height ?? 56
      };
      const read = (container: ElkNode, offsetX: number, offsetY: number): void => {
        for (const child of container.children ?? []) {
          const measured = graph.nodes.find((node) => node.id === child.id)!;
          const x = offsetX + (child.x ?? 0);
          const y = offsetY + (child.y ?? 0);
          placement.nodes[child.id] = {
            x,
            y,
            width: child.width ?? measured.width,
            height: child.height ?? measured.height
          };
          read(child, x, y);
        }
        for (const edge of container.edges ?? []) {
          // ELK edge coordinates are relative to their reported containing node.
          const owner = edge.container ? placement.nodes[edge.container] : undefined;
          const x = owner ? owner.x : offsetX;
          const y = owner ? owner.y : offsetY;
          const points = (edge.sections ?? [])
            .flatMap((section) => [
              section.startPoint,
              ...(section.bendPoints ?? []),
              section.endPoint
            ])
            .map((point) => ({ x: point.x + x, y: point.y + y }));
          const label = edge.labels?.[0];
          placement.edges[edge.id] = {
            points,
            ...(label
              ? {
                  label: {
                    x: x + (label.x ?? 0) + (label.width ?? 0) / 2,
                    y: y + (label.y ?? 0) + 5 + 11
                  }
                }
              : {})
          };
        }
      };
      read(result, 0, 0);
      return placement;
    }
  };
}
