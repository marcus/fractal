import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPOSITION_METRICS } from '../src/lib/composition/place';
import { routeBridge, type RouteEndpoint } from '../src/lib/composition/route';
import type { Frame } from '../src/lib/composition/types';
import type { Point } from '../src/lib/core/types';

const frame = (x: number, y: number, width: number, height: number): Frame => ({
  x,
  y,
  width,
  height
});

const endpoint = (box: Frame, port: Point): RouteEndpoint => ({
  frame: box,
  content: box,
  port
});

function crossesRect(a: Point, b: Point, rect: Frame): boolean {
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

function inside(point: Point, rect: Frame): boolean {
  return (
    point.x > rect.x &&
    point.x < rect.x + rect.width &&
    point.y > rect.y &&
    point.y < rect.y + rect.height
  );
}

test('two-adjacent-frame routes are unchanged when no other frame is supplied', () => {
  const left = frame(0, 0, 400, 200);
  const right = frame(400 + COMPOSITION_METRICS.gap, 0, 300, 180);
  const source = endpoint(left, { x: left.x + left.width, y: 80 });
  const target = endpoint(right, { x: right.x, y: 90 });
  const direct = routeBridge(source, target, ['call']);
  const withEmpty = routeBridge(source, target, ['call'], []);
  assert.deepEqual(withEmpty, direct);
  assert.ok(direct.points.length >= 3 && direct.points.length <= 5);
  assert.ok(direct.label.x > left.x + left.width && direct.label.x < right.x);
});

test('a sidecar/td/recall-shaped span escapes above td instead of crossing it', () => {
  const sidecar = frame(0, 0, 3394.54, 979.5);
  const td = frame(3466.54, 0, 3352.81, 1922);
  const recall = frame(6891.35, 0, 1171.69, 491);
  const source = endpoint(sidecar, { x: 2029.89, y: 259 });
  const target = endpoint(recall, { x: 7365.4, y: 297 });

  const blocked = routeBridge(source, target, ['recall-integration']);
  assert.ok(
    blocked.points.some(
      (point, index) => index > 0 && crossesRect(blocked.points[index - 1], point, td)
    ) || inside(blocked.label, td),
    'the direct corridor reproduces the reviewer’s crossing'
  );

  const routed = routeBridge(source, target, ['recall-integration'], [td]);
  for (let index = 1; index < routed.points.length; index++)
    assert.equal(
      crossesRect(routed.points[index - 1], routed.points[index], td),
      false,
      `segment ${index} crosses td`
    );
  assert.equal(inside(routed.label, td), false, 'label sits inside td');
  assert.deepEqual(routed.points[0], routed.sourcePoint);
  assert.deepEqual(routed.points[routed.points.length - 1], routed.targetPoint);
  assert.ok(routed.sourcePoint.x > sidecar.x, 'leaves sidecar on its facing side');
  assert.ok(routed.targetPoint.x < recall.x + recall.width, 'enters recall on its facing side');
});
