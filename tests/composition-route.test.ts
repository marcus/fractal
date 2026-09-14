import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPOSITION_METRICS } from '../src/lib/composition/place';
import { routeAxis, routeBridge, type RouteEndpoint } from '../src/lib/composition/route';
import type { Frame } from '../src/lib/composition/types';
import type { LayoutNode, Point } from '../src/lib/core/types';

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
  assert.deepEqual(direct.points, [
    { x: 400, y: 80 },
    { x: 436, y: 80 },
    { x: 436, y: 90 },
    { x: 472, y: 90 }
  ]);
  assert.deepEqual(direct.label, { x: 436, y: 85 });
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

const TITLE_H = 52;

function titleBandOf(box: Frame, titleHeight = TITLE_H): Frame {
  return { x: box.x, y: box.y, width: box.width, height: titleHeight };
}

function fakeNode(x: number, y: number, width: number, height: number): LayoutNode {
  return {
    id: 'n',
    sourceId: 'n',
    parent: null,
    title: 'n',
    kind: 'component',
    description: '',
    technology: '',
    status: 'current',
    color: '#267566',
    evidence: [],
    x,
    y,
    width,
    height,
    expanded: false,
    titleLines: ['n'],
    kindLabel: 'Component',
    descriptionLines: [],
    depth: 0
  };
}

function projectEndpoint(box: Frame, titleHeight = TITLE_H): RouteEndpoint {
  return { frame: box, content: box, titleHeight };
}

function nodeEndpoint(box: Frame, node: LayoutNode, titleHeight = TITLE_H): RouteEndpoint {
  return {
    frame: box,
    content: {
      x: box.x + COMPOSITION_METRICS.padding,
      y: box.y + titleHeight + COMPOSITION_METRICS.padding,
      width: Math.max(0, box.width - COMPOSITION_METRICS.padding * 2),
      height: Math.max(0, box.height - titleHeight - COMPOSITION_METRICS.padding * 2)
    },
    node,
    titleHeight
  };
}

function representativeRect(endpoint: RouteEndpoint): Frame {
  if (!endpoint.node) return endpoint.frame;
  return {
    x: endpoint.content.x + endpoint.node.x,
    y: endpoint.content.y + endpoint.node.y,
    width: endpoint.node.width,
    height: endpoint.node.height
  };
}

function assertSafeRoute(
  route: ReturnType<typeof routeBridge>,
  source: RouteEndpoint,
  target: RouteEndpoint,
  others: Frame[],
  label: string
): void {
  assert.deepEqual(route.points[0], route.sourcePoint, `${label} starts at source.point`);
  assert.deepEqual(
    route.points[route.points.length - 1],
    route.targetPoint,
    `${label} ends at target.point`
  );
  for (let index = 1; index < route.points.length; index++) {
    const from = route.points[index - 1];
    const to = route.points[index];
    assert.ok(
      from.x === to.x || from.y === to.y,
      `${label} segment ${index} is not axis-aligned (${from.x},${from.y})→(${to.x},${to.y})`
    );
  }
  const fromRect = representativeRect(source);
  const toRect = representativeRect(target);
  if (routeAxis(source.frame, target.frame) === 'horizontal') {
    const right =
      target.frame.x + target.frame.width / 2 >= source.frame.x + source.frame.width / 2;
    if (!source.port)
      assert.equal(
        route.sourcePoint.x,
        right ? fromRect.x + fromRect.width : fromRect.x,
        `${label} source is not on its facing edge`
      );
    if (!target.port)
      assert.equal(
        route.targetPoint.x,
        right ? toRect.x : toRect.x + toRect.width,
        `${label} target is not on its facing edge`
      );
  } else {
    const down =
      target.frame.y + target.frame.height / 2 >= source.frame.y + source.frame.height / 2;
    if (!source.port)
      assert.equal(
        route.sourcePoint.y,
        down ? fromRect.y + fromRect.height : fromRect.y,
        `${label} source is not on its facing edge`
      );
    if (!target.port)
      assert.equal(
        route.targetPoint.y,
        down ? toRect.y : toRect.y + toRect.height,
        `${label} target is not on its facing edge`
      );
  }
  const bands = [
    { name: 'source', band: titleBandOf(source.frame) },
    { name: 'target', band: titleBandOf(target.frame) },
    ...others.map((box, index) => ({ name: `other[${index}]`, band: titleBandOf(box) }))
  ];
  for (const { name, band } of bands) {
    for (let index = 1; index < route.points.length; index++)
      assert.equal(
        crossesRect(route.points[index - 1], route.points[index], band),
        false,
        `${label} segment ${index} crosses the ${name} title band`
      );
    assert.equal(inside(route.label, band), false, `${label} label sits in the ${name} title band`);
  }
  for (const [index, box] of others.entries()) {
    for (let seg = 1; seg < route.points.length; seg++)
      assert.equal(
        crossesRect(route.points[seg - 1], route.points[seg], box),
        false,
        `${label} segment ${seg} crosses non-endpoint frame ${index}`
      );
    assert.equal(
      inside(route.label, box),
      false,
      `${label} label sits inside non-endpoint frame ${index}`
    );
  }
}

test('stacked mixed-width frames route vertically, not through title bands', () => {
  // Reviewer unit case: collapsed sidecar beside a wide td, recall below, down engine.
  const sidecar = frame(0, 0, 260, 88);
  const td = frame(0, 160, 3861.23, 2571);
  const recall = frame(0, 2803, 748.71, 865);
  const nodeLocalX = 1679.86 - (td.x + COMPOSITION_METRICS.padding);
  const nodeLocalY = 826 - (td.y + TITLE_H + COMPOSITION_METRICS.padding);
  const source = projectEndpoint(sidecar);
  const target = nodeEndpoint(td, fakeNode(nodeLocalX, nodeLocalY, 280, 92));

  const routed = routeBridge(source, target, ['td-integration'], [recall]);
  assertSafeRoute(routed, source, target, [recall], 'sidecar/td-integration');
  assert.ok(
    routed.label.y > sidecar.y + sidecar.height && routed.label.y < td.y,
    `label y ${routed.label.y} is not in the stacked corridor`
  );
  assert.ok(
    routed.sourcePoint.y >= sidecar.y + TITLE_H,
    `project representative anchors inside the sidecar title band at y=${routed.sourcePoint.y}`
  );
});

test('a horizontal node-to-node target anchors on its near edge, not the far one', () => {
  const left = frame(0, 0, 400, 200);
  const rightBox = frame(400 + COMPOSITION_METRICS.gap, 0, 300, 200);
  const source = nodeEndpoint(left, fakeNode(40, 40, 100, 80));
  const target = nodeEndpoint(
    rightBox,
    fakeNode(510 - (rightBox.x + COMPOSITION_METRICS.padding), 40, 100, 80)
  );
  const routed = routeBridge(source, target, ['call']);
  const to = representativeRect(target);
  assert.equal(to.x, 510);
  assert.equal(to.x + to.width, 610);
  assert.equal(routed.targetPoint.x, 510);
  assertSafeRoute(routed, source, target, [], 'node-node rightward');
});

test('node and project representatives face each other on both axes', () => {
  const left = frame(0, 0, 400, 200);
  const rightBox = frame(400 + COMPOSITION_METRICS.gap, 0, 200, 200);
  const top = frame(0, 0, 400, 200);
  const bottom = frame(0, 200 + COMPOSITION_METRICS.gap, 400, 200);
  const kinds = ['node', 'project'] as const;
  const of = (box: Frame, kind: (typeof kinds)[number]): RouteEndpoint =>
    kind === 'node' ? nodeEndpoint(box, fakeNode(40, 40, 100, 80)) : projectEndpoint(box);
  for (const src of kinds) {
    for (const tgt of kinds) {
      const hSource = of(left, src);
      const hTarget = of(rightBox, tgt);
      assertSafeRoute(
        routeBridge(hSource, hTarget, ['h']),
        hSource,
        hTarget,
        [],
        `h ${src}→${tgt}`
      );
      assertSafeRoute(
        routeBridge(hTarget, hSource, ['hr']),
        hTarget,
        hSource,
        [],
        `h ${tgt}→${src}`
      );
      const vSource = of(top, src);
      const vTarget = of(bottom, tgt);
      assertSafeRoute(
        routeBridge(vSource, vTarget, ['v']),
        vSource,
        vTarget,
        [],
        `v ${src}→${tgt}`
      );
      assertSafeRoute(
        routeBridge(vTarget, vSource, ['vr']),
        vTarget,
        vSource,
        [],
        `v ${tgt}→${src}`
      );
    }
  }
});

const modes = ['open', 'collapsed'] as const;
const engines = ['elk-layered', 'elk-layered-down'] as const;

function sizeFor(mode: 'open' | 'collapsed', open: Frame): Frame {
  return mode === 'collapsed' ? frame(open.x, open.y, 260, 88) : open;
}

function placeEngine(engine: (typeof engines)[number], sizes: Frame[]): Frame[] {
  const placed: Frame[] = [];
  let cursor = 0;
  for (const size of sizes) {
    placed.push(
      engine === 'elk-layered-down'
        ? frame(0, cursor, size.width, size.height)
        : frame(cursor, 0, size.width, size.height)
    );
    cursor += (engine === 'elk-layered-down' ? size.height : size.width) + COMPOSITION_METRICS.gap;
  }
  return placed;
}

function endpointFor(box: Frame, mode: 'open' | 'collapsed'): RouteEndpoint {
  if (mode === 'collapsed') return projectEndpoint(box);
  return nodeEndpoint(box, fakeNode(40, 40, 280, 92));
}

test('mixed-width frames keep bridges out of title bands and non-endpoints on both engines', () => {
  const openSizes = [
    frame(0, 0, 3394.54, 979.5),
    frame(0, 0, 3861.23, 2571),
    frame(0, 0, 748.71, 865)
  ];
  const pairs: [number, number][] = [
    [0, 1],
    [1, 2],
    [0, 2]
  ];
  for (const engine of engines) {
    for (const a of modes) {
      for (const b of modes) {
        for (const c of modes) {
          const combo = [a, b, c] as const;
          const placed = placeEngine(
            engine,
            openSizes.map((size, index) => sizeFor(combo[index], size))
          );
          for (const [i, j] of pairs) {
            const source = endpointFor(placed[i], combo[i]);
            const target = endpointFor(placed[j], combo[j]);
            const others = placed.filter((_, index) => index !== i && index !== j);
            const label = `${engine} ${combo.join('/')} ${i}→${j}`;
            const routed = routeBridge(source, target, [label], others);
            assertSafeRoute(routed, source, target, others, label);
          }
        }
      }
    }
  }
});
