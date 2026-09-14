import { EDGE_LABEL_SIZE, EDGE_LABEL_WIDTH } from '../core/measure';
import { textWidth } from '../core/projection';
import type { LayoutNode, Point } from '../core/types';
import { COMPOSITION_METRICS } from './place';
import type { Frame } from './types';

/**
 * Bridge routing between one source and one target representative. `node` carries a local
 * diagram node; its composed rectangle comes from `content`, so routing never guesses a frame
 * transform. Without a node the representative is the project frame (a collapsed project or a
 * perimeter port). Points are ordered source → target; renderers draw the arrow at the last point.
 */
export interface RouteEndpoint {
  frame: Frame;
  content: Frame;
  node?: LayoutNode;
}

export interface BridgeRoute {
  points: Point[];
  label: Point;
  sourcePoint: Point;
  targetPoint: Point;
}

function rectFor(endpoint: RouteEndpoint): Frame {
  if (!endpoint.node) return endpoint.frame;
  return {
    x: endpoint.content.x + endpoint.node.x,
    y: endpoint.content.y + endpoint.node.y,
    width: endpoint.node.width,
    height: endpoint.node.height
  };
}

function labelBox(lines: string[]): { width: number; height: number } {
  if (!lines.length) return { width: 0, height: 0 };
  const width = Math.min(
    EDGE_LABEL_WIDTH,
    Math.max(...lines.map((line) => textWidth(line, EDGE_LABEL_SIZE))) + 14
  );
  return { width, height: lines.length * 15 + 10 };
}

/**
 * An orthogonal path that leaves the source representative on its facing side, crosses the
 * corridor between the two frames outside both title bands, and enters the target on its facing
 * side. Horizontal frames cross at a corridor x; stacked frames escape beside both frames and
 * cross at a y, so a title band is never entered from above or below.
 */
export function routeBridge(
  source: RouteEndpoint,
  target: RouteEndpoint,
  labelLines: string[]
): BridgeRoute {
  const from = rectFor(source);
  const to = rectFor(target);
  const fromCenter: Point = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter: Point = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const horizontal = Math.abs(toCenter.x - fromCenter.x) >= Math.abs(toCenter.y - fromCenter.y);
  const box = labelBox(labelLines);
  let sourcePoint: Point;
  let targetPoint: Point;
  let points: Point[];
  let crossing: Point;

  if (horizontal) {
    const right = toCenter.x >= fromCenter.x;
    const sourceX = right ? from.x + from.width : from.x;
    const targetX = right ? to.x : to.x + to.width;
    const corridorX = right ? (from.x + from.width + to.x) / 2 : (to.x + to.width + from.x) / 2;
    sourcePoint = { x: sourceX, y: fromCenter.y };
    targetPoint = { x: targetX, y: toCenter.y };
    points =
      sourcePoint.y === targetPoint.y
        ? [sourcePoint, { x: corridorX, y: sourcePoint.y }, targetPoint]
        : [
            sourcePoint,
            { x: corridorX, y: sourcePoint.y },
            { x: corridorX, y: targetPoint.y },
            targetPoint
          ];
    crossing = { x: corridorX, y: (sourcePoint.y + targetPoint.y) / 2 };
  } else {
    const down = toCenter.y >= fromCenter.y;
    const sourceY = down ? from.y + from.height : from.y;
    const targetY = down ? to.y : to.y + to.height;
    const escapeX =
      toCenter.x >= fromCenter.x
        ? Math.max(from.x + from.width, to.x + to.width) + COMPOSITION_METRICS.gap / 2
        : Math.min(from.x, to.x) - COMPOSITION_METRICS.gap / 2;
    sourcePoint = { x: fromCenter.x, y: sourceY };
    targetPoint = { x: toCenter.x, y: targetY };
    points = [
      sourcePoint,
      { x: escapeX, y: sourcePoint.y },
      { x: escapeX, y: targetPoint.y },
      targetPoint
    ];
    crossing = { x: escapeX, y: (sourcePoint.y + targetPoint.y) / 2 };
  }

  return {
    points,
    label: { x: crossing.x + box.width / 2 + 6, y: crossing.y },
    sourcePoint,
    targetPoint
  };
}
