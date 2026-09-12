import type { Point } from '../core/types';

export interface QuadraticSegment {
  control: Point;
  end: Point;
}
export interface EdgeCurve {
  start: Point;
  segments: QuadraticSegment[];
}
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
});

/**
 * Where a connection between two boxes would meet them, when no engine route is known yet — a
 * new edge that has to morph in from somewhere. Each end sits on the border facing the other
 * box, so a left-to-right engine gets right/left ports and a top-to-bottom engine gets
 * bottom/top ones without either being named here. Reading the geometry rather than the engine
 * id keeps a future engine's routes moving correctly too.
 */
export function facingBorderPoints(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): [Point, Point] {
  const centre = (box: typeof a): Point => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  });
  const from = centre(a);
  const to = centre(b);
  if (Math.abs(to.y - from.y) > Math.abs(to.x - from.x)) {
    const downward = to.y >= from.y;
    return [
      { x: from.x, y: downward ? a.y + a.height : a.y },
      { x: to.x, y: downward ? b.y : b.y + b.height }
    ];
  }
  const rightward = to.x >= from.x;
  return [
    { x: rightward ? a.x + a.width : a.x, y: from.y },
    { x: rightward ? b.x : b.x + b.width, y: to.y }
  ];
}

/** Same 12px rounded route used at rest, expressed entirely as quadratic curves. */
export function roundedEdgeCurve(points: Point[]): EdgeCurve {
  const start = points[0] ?? { x: 0, y: 0 };
  const segments: QuadraticSegment[] = [];
  let current = start;
  const line = (end: Point) => {
    segments.push({ control: mix(current, end, 0.5), end });
    current = end;
  };
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1];
    const before = Math.hypot(b.x - a.x, b.y - a.y);
    const after = Math.hypot(c.x - b.x, c.y - b.y);
    if (!before || !after) continue;
    const radius = Math.min(12, before / 2, after / 2);
    line(mix(b, a, radius / before));
    const end = mix(b, c, radius / after);
    segments.push({ control: b, end });
    current = end;
  }
  line(points.at(-1) ?? start);
  return { start, segments };
}

/** Split curves exactly, rather than sampling polylines and losing their corners. */
function subdivide(curve: EdgeCurve, count: number): EdgeCurve {
  const segments = [...curve.segments];
  while (segments.length < count) {
    let longest = -1,
      index = 0;
    for (let i = 0; i < segments.length; i++) {
      const start = i ? segments[i - 1].end : curve.start;
      const { control, end } = segments[i];
      const length =
        Math.hypot(control.x - start.x, control.y - start.y) +
        Math.hypot(end.x - control.x, end.y - control.y);
      if (length > longest) {
        longest = length;
        index = i;
      }
    }
    const start = index ? segments[index - 1].end : curve.start;
    const { control, end } = segments[index];
    const left = mix(start, control, 0.5),
      right = mix(control, end, 0.5);
    segments.splice(
      index,
      1,
      { control: left, end: mix(left, right, 0.5) },
      { control: right, end }
    );
  }
  return { start: curve.start, segments };
}

export function prepareEdgeMorph(from: EdgeCurve, to: EdgeCurve) {
  const count = Math.max(from.segments.length, to.segments.length);
  return { from: subdivide(from, count), to: subdivide(to, count) };
}

export function interpolateEdgeCurve(
  morph: ReturnType<typeof prepareEdgeMorph>,
  t: number
): EdgeCurve {
  return {
    start: mix(morph.from.start, morph.to.start, t),
    segments: morph.to.segments.map((segment, i) => ({
      control: mix(morph.from.segments[i].control, segment.control, t),
      end: mix(morph.from.segments[i].end, segment.end, t)
    }))
  };
}

export function edgeCurvePath(curve: EdgeCurve): string {
  let path = `M ${curve.start.x} ${curve.start.y}`;
  for (const { control, end } of curve.segments)
    path += ` Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  return path;
}
