import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api';
import type {
  LayoutEngine,
  LayoutRequest,
  MeasuredGraph,
  MeasuredNode,
  Placement
} from '../../core/layout-engine';
import type { LayoutEngineId, Point } from '../../core/types';

/** A card a repaired route must not be sent through. */
export interface RouteObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Whether an orthogonal segment passes through a card's interior. The one-unit inset keeps a route
 * that runs along a border, or meets it at an endpoint, from counting as a crossing.
 */
function crossesCard(from: Point, to: Point, card: RouteObstacle): boolean {
  const left = card.x + 1;
  const right = card.x + card.width - 1;
  const top = card.y + 1;
  const bottom = card.y + card.height - 1;
  if (Math.abs(from.x - to.x) <= 0.5)
    return (
      from.x > left &&
      from.x < right &&
      Math.max(from.y, to.y) > top &&
      Math.min(from.y, to.y) < bottom
    );
  return (
    from.y > top &&
    from.y < bottom &&
    Math.max(from.x, to.x) > left &&
    Math.min(from.x, to.x) < right
  );
}

/**
 * Make one ELK route orthogonal.
 *
 * ELK's orthogonal router returns clean right-angled routes flowing right, but when the flow runs
 * downward it occasionally hands back a single section whose bend points include one step that is
 * neither horizontal nor vertical: an edge crossing a container boundary picks up the corner of a
 * centred label's dummy, or jumps between two routing corridors, without the corner that would
 * join them. It is one section, so nothing is being concatenated or dropped on the way in — the
 * points ELK gives are simply not a right-angled path.
 *
 * The repair is local and deterministic: at a slanted step, turn the corner that continues the
 * direction the route was already travelling — unless one of that corner's two segments would run
 * through a collapsed card, in which case the other corner is taken. A diagonal can cut a corner
 * no right-angled path can, so squaring it up without looking at the cards sends routes straight
 * through them. Redundant interior points are then dropped, including the ones that now double
 * back along a line they already ran. Endpoints are never moved, so an edge still meets its nodes
 * exactly where the engine put it, and a route that is already orthogonal is returned untouched,
 * so an engine that never produces one of these keeps byte-identical geometry.
 */
export function orthogonalRoute(
  points: Point[],
  firstAxis: 'h' | 'v',
  obstacles: readonly RouteObstacle[] = []
): Point[] {
  const apart = (a: number, b: number) => Math.abs(a - b) > 0.5;
  if (!points.some((p, i) => i > 0 && apart(p.x, points[i - 1].x) && apart(p.y, points[i - 1].y)))
    return points;
  const clear = (from: Point, corner: Point, to: Point): boolean =>
    !obstacles.some((card) => crossesCard(from, corner, card) || crossesCard(corner, to, card));
  const route: Point[] = [points[0]];
  let axis = firstAxis;
  for (const point of points.slice(1)) {
    const last = route[route.length - 1];
    const horizontal = apart(point.x, last.x);
    const vertical = apart(point.y, last.y);
    if (!horizontal && !vertical) continue;
    if (horizontal && vertical) {
      const along = axis === 'h' ? { x: point.x, y: last.y } : { x: last.x, y: point.y };
      const across = axis === 'h' ? { x: last.x, y: point.y } : { x: point.x, y: last.y };
      // Turning the other way leaves the route travelling on the axis it was already on.
      if (clear(last, along, point) || !clear(last, across, point)) {
        route.push(along);
        axis = axis === 'h' ? 'v' : 'h';
      } else route.push(across);
    } else axis = horizontal ? 'h' : 'v';
    route.push(point);
  }
  for (let i = route.length - 2; i > 0; i--) {
    const [before, at, after] = [route[i - 1], route[i], route[i + 1]];
    if (
      (!apart(before.x, at.x) && !apart(at.x, after.x)) ||
      (!apart(before.y, at.y) && !apart(at.y, after.y))
    )
      route.splice(i, 1);
  }
  return route;
}

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
      const readNodes = (container: ElkNode, offsetX: number, offsetY: number): void => {
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
          readNodes(child, x, y);
        }
      };
      // Every node is placed before any route is read, so a repair sees the whole diagram rather
      // than whichever cards this container happened to reach first.
      readNodes(result, 0, 0);
      const cards = down
        ? graph.nodes
            .filter((node) => !node.expanded && placement.nodes[node.id])
            .map((node) => ({ id: node.id, ...placement.nodes[node.id] }))
        : [];
      const endpoints = new Map(graph.edges.map((edge) => [edge.id, [edge.source, edge.target]]));
      const readEdges = (container: ElkNode, offsetX: number, offsetY: number): void => {
        for (const child of container.children ?? [])
          readEdges(child, offsetX + (child.x ?? 0), offsetY + (child.y ?? 0));
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
            // A route leaves its source on the side this engine's ports sit on, so that is the
            // direction a repaired corner continues, and every other collapsed card is something
            // it has to stay out of. Only the downward engine repairs. Every route the default
            // engine has been measured on is already orthogonal, so the repair would be a no-op
            // there — but its geometry is fingerprinted and frozen, and turning a repair loose on
            // it is the kind of change this plan insists be explicit. The contract test asserts
            // orthogonality for both engines, so a default route that ever needs it will fail
            // loudly rather than change quietly.
            points: down
              ? orthogonalRoute(
                  points,
                  'v',
                  cards.filter((card) => !endpoints.get(edge.id)?.includes(card.id))
                )
              : points,
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
      readEdges(result, 0, 0);
      return placement;
    }
  };
}
