import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roundedEdgeCurve,
  prepareEdgeMorph,
  interpolateEdgeCurve,
  edgeCurvePath,
  facingBorderPoints,
  type EdgeCurve
} from '../src/lib/ui/edge-motion';

function samples(curve: EdgeCurve) {
  return curve.segments.flatMap(({ control, end }, i) => {
    const start = i ? curve.segments[i - 1].end : curve.start;
    return Array.from({ length: 1001 }, (_, j) => {
      const t = j / 1000,
        u = 1 - t;
      return {
        x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
        y: u * u * start.y + 2 * u * t * control.y + t * t * end.y
      };
    });
  });
}
function sameGeometry(actual: EdgeCurve, expected: EdgeCurve) {
  assert.deepEqual(actual.start, expected.start);
  assert.deepEqual(actual.segments.at(-1)?.end, expected.segments.at(-1)?.end);
  const reference = samples(expected);
  for (const p of samples(actual).filter((_, i) => i % 100 === 0)) {
    assert.ok(
      reference.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.1),
      `Curve changed near ${JSON.stringify(p)}`
    );
  }
}

test('rounded route preserves 12px corners and exact endpoints', () => {
  const curve = roundedEdgeCurve([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 }
  ]);
  assert.deepEqual(curve, {
    start: { x: 0, y: 0 },
    segments: [
      { control: { x: 44, y: 0 }, end: { x: 88, y: 0 } },
      { control: { x: 100, y: 0 }, end: { x: 100, y: 12 } },
      { control: { x: 100, y: 56 }, end: { x: 100, y: 100 } }
    ]
  });
});

test('different route topologies keep exact rounded geometry at both animation endpoints', () => {
  const from = roundedEdgeCurve([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 }
  ]);
  const to = roundedEdgeCurve([
    { x: 20, y: 10 },
    { x: 60, y: 10 },
    { x: 60, y: 160 },
    { x: 200, y: 160 }
  ]);
  const morph = prepareEdgeMorph(from, to);
  assert.equal(morph.from.segments.length, morph.to.segments.length);
  sameGeometry(interpolateEdgeCurve(morph, 0), from);
  sameGeometry(interpolateEdgeCurve(morph, 1), to);
  const halfway = interpolateEdgeCurve(morph, 0.5);
  assert.deepEqual(halfway.start, { x: 10, y: 5 });
  assert.deepEqual(halfway.segments.at(-1)?.end, { x: 150, y: 130 });
  // A rapid second expansion starts from the rendered curve, not stale route points.
  const interrupted = prepareEdgeMorph(
    halfway,
    roundedEdgeCurve([
      { x: 5, y: 10 },
      { x: 210, y: 20 }
    ])
  );
  sameGeometry(interpolateEdgeCurve(interrupted, 0), halfway);
});

test('empty and duplicate-point routes produce finite paths', () => {
  for (const points of [
    [],
    [{ x: 5, y: 5 }],
    [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 10, y: 5 }
    ]
  ]) {
    const from = roundedEdgeCurve(points);
    const morph = prepareEdgeMorph(
      from,
      roundedEdgeCurve([
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 80, y: 40 }
      ])
    );
    for (const t of [0, 0.5, 1])
      assert.doesNotMatch(edgeCurvePath(interpolateEdgeCurve(morph, t)), /NaN|Infinity/);
  }
});

test('synthesised endpoints sit on the borders the two boxes face each other with', () => {
  const box = (x: number, y: number) => ({ x, y, width: 100, height: 40 });
  // Side by side: the left-to-right engine's right and left ports.
  assert.deepEqual(facingBorderPoints(box(0, 0), box(300, 10)), [
    { x: 100, y: 20 },
    { x: 300, y: 30 }
  ]);
  assert.deepEqual(facingBorderPoints(box(300, 0), box(0, 0)), [
    { x: 300, y: 20 },
    { x: 100, y: 20 }
  ]);
  // Stacked: the top-to-bottom engine's bottom and top ports.
  assert.deepEqual(facingBorderPoints(box(0, 0), box(10, 300)), [
    { x: 50, y: 40 },
    { x: 60, y: 300 }
  ]);
  assert.deepEqual(facingBorderPoints(box(0, 300), box(0, 0)), [
    { x: 50, y: 300 },
    { x: 50, y: 40 }
  ]);
});
