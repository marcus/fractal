import type { Diagram, Point } from '../core/types';
import type { QualityMetrics } from './types';

/** Geometry is in layout units of hundreds; this is well below any meaningful difference. */
const EPSILON = 1e-6;

const cross = (origin: Point, a: Point, b: Point): number =>
  (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);

const opposite = (a: number, b: number): boolean =>
  (a > EPSILON && b < -EPSILON) || (a < -EPSILON && b > EPSILON);

/**
 * A proper crossing: each segment passes through the interior of the other. Segments that only
 * touch at an endpoint are not crossings — edges that share a port always meet there.
 */
export function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  return (
    opposite(cross(b1, b2, a1), cross(b1, b2, a2)) && opposite(cross(a1, a2, b1), cross(a1, a2, b2))
  );
}

function segments(points: readonly Point[]): [Point, Point][] {
  const result: [Point, Point][] = [];
  for (let i = 0; i < points.length - 1; i++) result.push([points[i], points[i + 1]]);
  return result;
}

/** Interior points where the polyline turns. Collinear points are not bends. */
export function bendCount(points: readonly Point[]): number {
  let count = 0;
  for (let i = 1; i < points.length - 1; i++)
    if (Math.abs(cross(points[i], points[i - 1], points[i + 1])) > EPSILON) count++;
  return count;
}

export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (const [from, to] of segments(points)) total += Math.hypot(to.x - from.x, to.y - from.y);
  return total;
}

const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
};

/**
 * Engine-neutral composition quality, cheap enough to compute on every benchmark row.
 * Lower crossings, bends and edge length read as a tidier diagram; area and aspect ratio say
 * how much canvas the engine spent and what shape it produced.
 */
export function qualityMetrics(diagram: Diagram): QualityMetrics {
  const routes = diagram.edges.map((edge) => segments(edge.points));
  let crossings = 0;
  for (let i = 0; i < routes.length; i++)
    for (let j = i + 1; j < routes.length; j++)
      for (const [a1, a2] of routes[i])
        for (const [b1, b2] of routes[j]) if (segmentsCross(a1, a2, b1, b2)) crossings++;
  return {
    crossings,
    bends: diagram.edges.reduce((total, edge) => total + bendCount(edge.points), 0),
    edgeLength: round(
      diagram.edges.reduce((total, edge) => total + polylineLength(edge.points), 0),
      2
    ),
    area: round(diagram.width * diagram.height, 2),
    aspectRatio: diagram.height > 0 ? round(diagram.width / diagram.height, 4) : 0
  };
}
