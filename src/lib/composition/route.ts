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
  /** Title-band height of `frame`; project representatives anchor below it. */
  titleHeight?: number;
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

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

function clearGap(a0: number, a1: number, b0: number, b1: number): number {
  if (a1 < b0) return b0 - a1;
  if (b1 < a0) return a0 - b1;
  return 0;
}

/**
 * Axis from the frames' actual separation, not their centres: stacked frames (overlap in x)
 * route vertically even when a wide neighbour's centre sits far to one side; side-by-side
 * frames (overlap in y) route horizontally. When neither overlaps, the larger clear gap wins.
 */
export function routeAxis(from: Frame, to: Frame): 'horizontal' | 'vertical' {
  const overlapX = overlaps(from.x, from.x + from.width, to.x, to.x + to.width);
  const overlapY = overlaps(from.y, from.y + from.height, to.y, to.y + to.height);
  if (overlapX && !overlapY) return 'vertical';
  if (overlapY && !overlapX) return 'horizontal';
  if (!overlapX && !overlapY)
    return clearGap(from.x, from.x + from.width, to.x, to.x + to.width) >=
      clearGap(from.y, from.y + from.height, to.y, to.y + to.height)
      ? 'horizontal'
      : 'vertical';
  return 'vertical';
}

/** Facing-side anchor for a project representative, always below that frame's title band. */
function projectAnchor(
  frame: Frame,
  titleHeight: number,
  horizontal: boolean,
  right: boolean,
  down: boolean
): Point {
  const bandBottom = frame.y + titleHeight;
  const body = Math.max(0, frame.height - titleHeight);
  if (horizontal) {
    const midY = frame.y + frame.height / 2;
    const y = midY >= bandBottom ? midY : bandBottom + body / 2;
    return { x: right ? frame.x + frame.width : frame.x, y };
  }
  return {
    x: frame.x + frame.width / 2,
    y: down ? frame.y + frame.height : frame.y
  };
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
 * The axis follows frame overlap, not centre deltas, so a narrow stacked frame beside a wide
 * one still routes vertically. A project representative anchors below its title band on the
 * facing side (the same rule as port slots), never at mid-height inside the band.
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
  const sourceFrameCenter = center(source.frame);
  const targetFrameCenter = center(target.frame);
  const horizontal = routeAxis(source.frame, target.frame) === 'horizontal';
  let sourcePoint: Point;
  let targetPoint: Point;
  let points: Point[];
  let crossing: Point;
  const involved = [source.frame, target.frame, ...otherFrames];
  const projectPoint = (
    endpoint: RouteEndpoint,
    rect: Frame,
    right: boolean,
    down: boolean
  ): Point =>
    endpoint.node
      ? horizontal
        ? { x: right ? rect.x + rect.width : rect.x, y: rect.y + rect.height / 2 }
        : { x: rect.x + rect.width / 2, y: down ? rect.y + rect.height : rect.y }
      : projectAnchor(endpoint.frame, endpoint.titleHeight ?? 0, horizontal, right, down);

  if (horizontal) {
    const right = targetFrameCenter.x >= sourceFrameCenter.x;
    const x = corridorX(source.frame, target.frame, right);
    sourcePoint = source.port ?? projectPoint(source, from, right, false);
    targetPoint = target.port ?? projectPoint(target, to, right, false);
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
    sourcePoint = source.port ?? projectPoint(source, from, right, down);
    targetPoint = target.port ?? projectPoint(target, to, right, down);
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
