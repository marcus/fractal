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

function center(frame: Frame): Point {
  return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
}

/** The frame gap on the side of `from` that faces `to`, always outside both title bands. */
function corridorX(from: Frame, to: Frame, right: boolean): number {
  return right ? (from.x + from.width + to.x) / 2 : (to.x + to.width + from.x) / 2;
}

/** A vertical escape line beside both frames, always outside both title bands. */
function escapeX(from: Frame, to: Frame, right: boolean): number {
  return right
    ? Math.max(from.x + from.width, to.x + to.width) + COMPOSITION_METRICS.gap / 2
    : Math.min(from.x, to.x) - COMPOSITION_METRICS.gap / 2;
}

/**
 * An orthogonal path that leaves the source representative on its facing side, crosses the gap
 * between the two project frames (never a representative rectangle, so the crossing and label
 * stay out of every title band and node card), and enters the target on its facing side. Frames
 * side by side cross at a corridor x; stacked frames escape beside both frames and cross at a y.
 * The label is the crossing point itself; renderers centre the label on that point.
 */
export function routeBridge(
  source: RouteEndpoint,
  target: RouteEndpoint,
  labelLines: string[]
): BridgeRoute {
  const from = rectFor(source);
  const to = rectFor(target);
  const fromCenter = center(from);
  const toCenter = center(to);
  const sourceFrameCenter = center(source.frame);
  const targetFrameCenter = center(target.frame);
  const horizontal =
    Math.abs(targetFrameCenter.x - sourceFrameCenter.x) >=
    Math.abs(targetFrameCenter.y - sourceFrameCenter.y);
  let sourcePoint: Point;
  let targetPoint: Point;
  let points: Point[];
  let crossing: Point;

  if (horizontal) {
    const right = targetFrameCenter.x >= sourceFrameCenter.x;
    const x = corridorX(source.frame, target.frame, right);
    sourcePoint = { x: right ? from.x + from.width : from.x, y: fromCenter.y };
    targetPoint = { x: right ? to.x : to.x + to.width, y: toCenter.y };
    points =
      sourcePoint.y === targetPoint.y
        ? [sourcePoint, { x, y: sourcePoint.y }, targetPoint]
        : [sourcePoint, { x, y: sourcePoint.y }, { x, y: targetPoint.y }, targetPoint];
    crossing = { x, y: (sourcePoint.y + targetPoint.y) / 2 };
  } else {
    const down = targetFrameCenter.y >= sourceFrameCenter.y;
    const x = escapeX(source.frame, target.frame, targetFrameCenter.x >= sourceFrameCenter.x);
    sourcePoint = { x: fromCenter.x, y: down ? from.y + from.height : from.y };
    targetPoint = { x: toCenter.x, y: down ? to.y : to.y + to.height };
    points = [sourcePoint, { x, y: sourcePoint.y }, { x, y: targetPoint.y }, targetPoint];
    const near = down ? source.frame.y + source.frame.height : source.frame.y;
    const far = down ? target.frame.y : target.frame.y + target.frame.height;
    crossing = { x, y: (near + far) / 2 };
  }

  return { points, label: crossing, sourcePoint, targetPoint };
}
