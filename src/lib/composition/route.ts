import type { LayoutNode, Point } from '../core/types';
import { COMPOSITION_METRICS } from './place';
import type { Frame } from './types';

/**
 * Bridge routing between one source and one target representative. `node` carries a local
 * diagram node; its composed rectangle comes from `content`, so routing never guesses a frame
 * transform. Without a node the representative is the project frame (a collapsed project).
 * `port` is a perimeter point in composed coordinates for an outside-scope endpoint; the
 * bridge ends there instead of the frame-edge midpoint. Points are ordered source → target;
 * renderers draw the arrow at the last point.
 */
export interface RouteEndpoint {
  frame: Frame;
  content: Frame;
  node?: LayoutNode;
  port?: Point;
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

/** A vertical escape line beside the given frames, always outside their title bands. */
function escapeX(frames: Frame[], right: boolean): number {
  return right
    ? Math.max(...frames.map((frame) => frame.x + frame.width)) + COMPOSITION_METRICS.gap / 2
    : Math.min(...frames.map((frame) => frame.x)) - COMPOSITION_METRICS.gap / 2;
}

function pointInInterior(point: Point, rect: Frame): boolean {
  return (
    point.x > rect.x &&
    point.x < rect.x + rect.width &&
    point.y > rect.y &&
    point.y < rect.y + rect.height
  );
}

/** True when an orthogonal segment overlaps the interior of a rectangle (a touch is not a cross). */
function segmentCrossesRect(a: Point, b: Point, rect: Frame): boolean {
  if (a.x === b.x)
    return (
      a.x > rect.x &&
      a.x < rect.x + rect.width &&
      Math.max(a.y, b.y) > rect.y &&
      Math.min(a.y, b.y) < rect.y + rect.height
    );
  if (a.y === b.y)
    return (
      a.y > rect.y &&
      a.y < rect.y + rect.height &&
      Math.max(a.x, b.x) > rect.x &&
      Math.min(a.x, b.x) < rect.x + rect.width
    );
  return false;
}

function obstructed(points: Point[], label: Point, others: Frame[]): boolean {
  return others.some(
    (frame) =>
      pointInInterior(label, frame) ||
      points.some(
        (point, index) => index > 0 && segmentCrossesRect(points[index - 1], point, frame)
      )
  );
}

function dropDuplicatePoints(points: Point[]): Point[] {
  const unique: Point[] = [];
  for (const point of points) {
    const last = unique[unique.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) unique.push(point);
  }
  return unique;
}

/**
 * An orthogonal path that leaves the source representative on its facing side, crosses the gap
 * between the two project frames (never a representative rectangle, so the crossing and label
 * stay out of every title band and node card), and enters the target on its facing side. Frames
 * side by side cross at a corridor x; stacked frames escape beside both frames and cross at a y.
 * When `otherFrames` is supplied and the direct corridor or any segment intersects a
 * non-endpoint frame, the path escapes to a lane outside every intervening frame instead.
 * Two-adjacent-frame routes (no other frames, or no intersection) keep the direct corridor.
 * The label is the crossing point itself; renderers centre the label on that point.
 * A port anchor keeps the same orthogonal shape: ports sit on the facing side, so the first
 * (or last) segment still leaves straight into the corridor or escape line.
 */
export function routeBridge(
  source: RouteEndpoint,
  target: RouteEndpoint,
  labelLines: string[] = [],
  otherFrames: Frame[] = []
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
  const involved = [source.frame, target.frame, ...otherFrames];

  if (horizontal) {
    const right = targetFrameCenter.x >= sourceFrameCenter.x;
    const x = corridorX(source.frame, target.frame, right);
    sourcePoint = source.port ?? { x: right ? from.x + from.width : from.x, y: fromCenter.y };
    targetPoint = target.port ?? { x: right ? to.x : to.x + to.width, y: toCenter.y };
    const direct =
      sourcePoint.y === targetPoint.y
        ? [sourcePoint, { x, y: sourcePoint.y }, targetPoint]
        : [sourcePoint, { x, y: sourcePoint.y }, { x, y: targetPoint.y }, targetPoint];
    const directLabel = { x, y: (sourcePoint.y + targetPoint.y) / 2 };
    if (!obstructed(direct, directLabel, otherFrames)) {
      points = direct;
      crossing = directLabel;
    } else {
      const yAbove = Math.min(...otherFrames.map((frame) => frame.y)) - COMPOSITION_METRICS.gap / 2;
      const yBelow =
        Math.max(...otherFrames.map((frame) => frame.y + frame.height)) +
        COMPOSITION_METRICS.gap / 2;
      const midY = (sourcePoint.y + targetPoint.y) / 2;
      const yLane = Math.abs(midY - yAbove) <= Math.abs(midY - yBelow) ? yAbove : yBelow;
      const outX = right
        ? source.frame.x + source.frame.width + COMPOSITION_METRICS.gap / 2
        : source.frame.x - COMPOSITION_METRICS.gap / 2;
      const inX = right
        ? target.frame.x - COMPOSITION_METRICS.gap / 2
        : target.frame.x + target.frame.width + COMPOSITION_METRICS.gap / 2;
      points = dropDuplicatePoints([
        sourcePoint,
        { x: outX, y: sourcePoint.y },
        { x: outX, y: yLane },
        { x: inX, y: yLane },
        { x: inX, y: targetPoint.y },
        targetPoint
      ]);
      crossing = { x: (outX + inX) / 2, y: yLane };
    }
  } else {
    const down = targetFrameCenter.y >= sourceFrameCenter.y;
    const right = targetFrameCenter.x >= sourceFrameCenter.x;
    sourcePoint = source.port ?? { x: fromCenter.x, y: down ? from.y + from.height : from.y };
    targetPoint = target.port ?? { x: toCenter.x, y: down ? to.y : to.y + to.height };
    const directX = escapeX([source.frame, target.frame], right);
    const direct = [
      sourcePoint,
      { x: directX, y: sourcePoint.y },
      { x: directX, y: targetPoint.y },
      targetPoint
    ];
    const near = down ? source.frame.y + source.frame.height : source.frame.y;
    const far = down ? target.frame.y : target.frame.y + target.frame.height;
    const directLabel = { x: directX, y: (near + far) / 2 };
    if (!obstructed(direct, directLabel, otherFrames)) {
      points = direct;
      crossing = directLabel;
    } else {
      const x = escapeX(involved, right);
      points = dropDuplicatePoints([
        sourcePoint,
        { x, y: sourcePoint.y },
        { x, y: targetPoint.y },
        targetPoint
      ]);
      crossing = { x, y: (near + far) / 2 };
    }
  }

  return { points, label: crossing, sourcePoint, targetPoint };
}
