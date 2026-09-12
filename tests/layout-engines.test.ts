import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import ELK from 'elkjs/lib/elk.bundled.js';
import { allLayoutEngines, getLayoutEngine } from '../src/lib/adapters/layout';
import { elkLayeredEngine } from '../src/lib/adapters/layout/elk';
import { layout } from '../src/lib/core/layout';
import {
  DEFAULT_LAYOUT_ENGINE,
  LAYOUT_ENGINES,
  getLayoutEngineInfo,
  isLayoutEngineId
} from '../src/lib/core/layout-engines';
import { measure } from '../src/lib/core/measure';
import { showAllStructure } from '../src/lib/core/navigation';
import { project, textWidth } from '../src/lib/core/projection';
import { loadDirectory } from '../src/lib/server/models';
import { ARCHITECTURE_NODE_METRICS as METRICS } from '../src/lib/core/node-metrics';
import type {
  Diagram,
  Element,
  LayoutNode,
  Model,
  Relationship,
  ViewState
} from '../src/lib/core/types';

/**
 * The contract every registered engine must honour, regardless of how it places things. These
 * checks are direction-agnostic: an engine may flow downward or radially and still pass.
 */

const element = (
  id: string,
  parent: string | null = null,
  status: 'current' | 'proposed' = 'current'
): Element => ({
  id,
  sourceId: id,
  parent,
  title: `${id} with a fairly long readable title`,
  kind: 'service',
  description: 'A useful system component with a clear responsibility and some more words.',
  technology: '',
  status,
  color: '#548573',
  evidence: []
});
const edge = (id: string, source: string, target: string, kind = 'calls'): Relationship => ({
  id,
  source,
  target,
  kind,
  title: 'Calls a well described interface',
  description: '',
  status: 'current'
});
const fixture: Model = {
  version: 1,
  id: 'contract',
  title: 'Contract fixture',
  description: 'A nested model with crossing connections.',
  provenance: 'test',
  elements: [
    element('client'),
    element('core'),
    element('worker', 'core'),
    element('store', 'core'),
    element('inner', 'worker'),
    element('deep', 'inner'),
    element('future', 'core', 'proposed'),
    element('ops')
  ],
  relationships: [
    edge('a', 'client', 'worker'),
    edge('b', 'client', 'store'),
    edge('c', 'client', 'worker', 'authorizes'),
    edge('d', 'worker', 'store'),
    edge('e', 'store', 'client', 'notifies'),
    edge('f', 'deep', 'store'),
    edge('g', 'ops', 'deep'),
    edge('h', 'ops', 'client')
  ],
  boundaries: [],
  scenes: []
};
const base: ViewState = { expanded: [], proposed: false, lens: 'structure' };
const fixtureViews: ViewState[] = [
  base,
  { ...base, expanded: ['core'] },
  { ...base, expanded: ['core', 'worker', 'inner'] },
  { ...base, expanded: ['core', 'worker'], scope: 'core' },
  { ...base, expanded: ['core'], proposed: true, lens: 'trust' }
];

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
/**
 * Whether one orthogonal step passes through a card's interior. The one-unit inset lets a route
 * run along a border or meet it at an endpoint without counting as a crossing.
 */
const crossesCard = (from: { x: number; y: number }, to: typeof from, card: Box): boolean => {
  const [left, right] = [card.x + 1, card.x + card.width - 1];
  const [top, bottom] = [card.y + 1, card.y + card.height - 1];
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
};
const onBorder = (point: { x: number; y: number }, node: Box, tolerance = 2): boolean => {
  const insideX = point.x >= node.x - tolerance && point.x <= node.x + node.width + tolerance;
  const insideY = point.y >= node.y - tolerance && point.y <= node.y + node.height + tolerance;
  const onVertical =
    Math.abs(point.x - node.x) <= tolerance ||
    Math.abs(point.x - (node.x + node.width)) <= tolerance;
  const onHorizontal =
    Math.abs(point.y - node.y) <= tolerance ||
    Math.abs(point.y - (node.y + node.height)) <= tolerance;
  return insideX && insideY && (onVertical || onHorizontal);
};

function assertContract(diagram: Diagram, label: string): void {
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const headerOf = (node: LayoutNode): number =>
    Math.max(
      METRICS.expandedHeaderMin,
      METRICS.expandedHeaderBase + node.titleLines.length * METRICS.titleLineHeight
    );
  for (const node of diagram.nodes) {
    assert.ok(node.width > 0 && node.height > 0, `${label}: ${node.id} has a size`);
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), `${label}: ${node.id} placed`);
    if (node.parent) {
      const parent = byId.get(node.parent)!;
      assert.ok(parent.expanded, `${label}: parent ${parent.id} of ${node.id} is expanded`);
      assert.ok(node.x > parent.x, `${label}: ${node.id} inside ${parent.id} (left)`);
      assert.ok(
        node.y >= parent.y + headerOf(parent),
        `${label}: ${node.id} below the header of ${parent.id}`
      );
      assert.ok(
        node.x + node.width < parent.x + parent.width,
        `${label}: ${node.id} inside ${parent.id} (right)`
      );
      assert.ok(
        node.y + node.height < parent.y + parent.height,
        `${label}: ${node.id} inside ${parent.id} (bottom)`
      );
    }
    for (const other of diagram.nodes)
      if (other.id !== node.id && other.parent === node.parent)
        assert.ok(!intersects(node, other), `${label}: siblings ${node.id}/${other.id} overlap`);
  }
  const labels: Box[] = [];
  for (const connection of diagram.edges) {
    const source = byId.get(connection.source)!;
    const target = byId.get(connection.target)!;
    assert.ok(connection.points.length >= 2, `${label}: ${connection.id} has a route`);
    assert.ok(
      onBorder(connection.points[0], source),
      `${label}: ${connection.id} starts on the border of ${source.id}`
    );
    assert.ok(
      onBorder(connection.points.at(-1)!, target),
      `${label}: ${connection.id} ends on the border of ${target.id}`
    );
    // Routes are orthogonal: every step runs along one axis. An engine that hands back a slanted
    // step has to repair it before the diagram is assembled, whatever its flow direction — and
    // squaring a step up must not send it through a card, which a diagonal could cut past.
    for (let index = 1; index < connection.points.length; index++) {
      const [from, to] = [connection.points[index - 1], connection.points[index]];
      assert.ok(
        Math.abs(to.x - from.x) <= 0.5 || Math.abs(to.y - from.y) <= 0.5,
        `${label}: ${connection.id} step ${index} runs diagonally, ${JSON.stringify(from)} to ${JSON.stringify(to)}`
      );
      for (const card of diagram.nodes)
        if (!card.expanded && card.id !== connection.source && card.id !== connection.target)
          assert.ok(
            !crossesCard(from, to, card),
            `${label}: ${connection.id} step ${index} runs through ${card.id}`
          );
    }
    if (!connection.labelLines.length) continue;
    const width = Math.max(...connection.labelLines.map((line) => textWidth(line, 11))) + 14;
    const box: Box = {
      x: connection.label.x - width / 2,
      y: connection.label.y - 13,
      width,
      height: connection.labelLines.length * 15 + 8
    };
    for (const node of diagram.nodes.filter((item) => !item.expanded))
      assert.ok(!intersects(box, node), `${label}: label ${connection.id} overlaps ${node.id}`);
    for (const other of labels)
      assert.ok(!intersects(box, other), `${label}: labels overlap at ${connection.id}`);
    labels.push(box);
  }
  assert.ok(diagram.width > 0 && diagram.height > 0, `${label}: diagram has an extent`);
  for (const node of diagram.nodes) {
    assert.ok(node.x >= 0 && node.y >= 0, `${label}: ${node.id} within the origin`);
    assert.ok(
      node.x + node.width <= diagram.width + 1 && node.y + node.height <= diagram.height + 1,
      `${label}: ${node.id} within the diagram extent`
    );
  }
}

test('the registry lists engines with metadata and rejects unknown ids everywhere', () => {
  assert.ok(LAYOUT_ENGINES.some((engine) => engine.id === DEFAULT_LAYOUT_ENGINE));
  assert.equal(getLayoutEngineInfo().id, DEFAULT_LAYOUT_ENGINE);
  assert.ok(isLayoutEngineId('elk-layered'));
  assert.ok(!isLayoutEngineId('bogus'));
  assert.throws(() => getLayoutEngineInfo('bogus'), /Unknown layout engine: bogus/);
  assert.throws(() => getLayoutEngine('bogus'), /Unknown layout engine/);
  assert.throws(
    () => project(fixture, { ...base, layout: 'bogus' as never }),
    /Unknown layout engine/
  );
  assert.deepEqual(
    allLayoutEngines().map((engine) => engine.id),
    LAYOUT_ENGINES.map((engine) => engine.id)
  );
  for (const engine of allLayoutEngines()) {
    const info = getLayoutEngineInfo(engine.id);
    assert.equal(engine.title, info.title);
    assert.equal(engine.description, info.description);
  }
});

test('a slanted ELK step becomes a corner, and an orthogonal route is left alone', async () => {
  const { orthogonalRoute } = await import('../src/lib/adapters/layout/elk');
  // Routes ELK returned for delivery show-all flowing downward: one section each, with a step
  // that is neither horizontal nor vertical. The first is a centred label's dummy corner; the
  // second jumps between two routing corridors.
  const labelSpur = [
    { x: 398, y: 200 },
    { x: 398, y: 258 },
    { x: 537, y: 258 },
    { x: 518, y: 382 },
    { x: 537, y: 382 },
    { x: 537, y: 554 },
    { x: 676, y: 554 },
    { x: 676, y: 676 }
  ];
  const corridorJump = [
    { x: 1343, y: 714 },
    { x: 1343, y: 772 },
    { x: 1482, y: 772 },
    { x: 937, y: 1315.5 },
    { x: 1076, y: 1315.5 },
    { x: 1076, y: 1540.5 }
  ];
  for (const points of [labelSpur, corridorJump]) {
    const route = orthogonalRoute(points, 'v');
    for (let index = 1; index < route.length; index++) {
      const [from, to] = [route[index - 1], route[index]];
      assert.ok(Math.abs(to.x - from.x) <= 0.5 || Math.abs(to.y - from.y) <= 0.5, 'orthogonal');
    }
    assert.deepEqual(route[0], points[0], 'the source endpoint does not move');
    assert.deepEqual(route.at(-1), points.at(-1), 'the target endpoint does not move');
  }
  // A corridor jump turns the corner that continues the direction it was already going, and the
  // detour it doubled back along collapses.
  assert.deepEqual(orthogonalRoute(corridorJump, 'v'), [
    { x: 1343, y: 714 },
    { x: 1343, y: 772 },
    { x: 937, y: 772 },
    { x: 937, y: 1315.5 },
    { x: 1076, y: 1315.5 },
    { x: 1076, y: 1540.5 }
  ]);
  const clean = [
    { x: 0, y: 0 },
    { x: 0, y: 40 },
    { x: 90, y: 40 }
  ];
  assert.equal(orthogonalRoute(clean, 'v'), clean, 'an orthogonal route is the same array');
});

test('measurement is engine-neutral, deterministic and depth-first', () => {
  const projection = project(fixture, { ...base, expanded: ['core', 'worker'] });
  const graph = measure(projection);
  assert.deepEqual(graph, measure(projection));
  assert.deepEqual(
    graph.nodes.map((node) => node.id),
    ['client', 'core', 'worker', 'inner', 'store', 'ops']
  );
  const core = graph.nodes.find((node) => node.id === 'core')!;
  assert.ok(core.expanded && core.headerHeight >= METRICS.expandedHeaderMin);
  assert.equal(graph.nodes.find((node) => node.id === 'inner')!.depth, 2);
  for (const edge of graph.edges) {
    assert.equal(edge.labelWidth > 0, edge.labelLines.length > 0);
    assert.equal(edge.labelHeight > 0, edge.labelLines.length > 0);
  }
});

for (const info of LAYOUT_ENGINES) {
  test(`${info.id}: places the fixture and the bundled examples within the contract`, async () => {
    const engine = getLayoutEngine(info.id);
    for (const view of fixtureViews) {
      const state = { ...view, layout: info.id };
      const diagram = await layout(fixture, state);
      assert.deepEqual(diagram, await layout(fixture, state), `${info.id} is deterministic`);
      const direct = await layout(fixture, view, engine);
      assert.deepEqual(direct, { ...diagram, state: direct.state });
      assert.equal(direct.state.layout, view.layout);
      assert.equal(diagram.state.layout, info.id);
      assertContract(diagram, `${info.id} ${JSON.stringify(view)}`);
    }
    for (const id of ['delivery', 'observatory']) {
      const { model } = await loadDirectory(`examples/${id}`);
      const views = [...model.scenes, showAllStructure(model, model.scenes[0])];
      for (const view of views) {
        const diagram = await layout(model, { ...view, layout: info.id });
        assertContract(diagram, `${info.id} ${id}/${'id' in view ? view.id : 'show-all'}`);
      }
    }
  });
}

/**
 * The ELK instance is injected so the portable document can run the same engine in a worker while
 * Node keeps the bundled main-thread build. Two instances standing in for the two environments
 * must place a view identically, or that swap would move geometry.
 */
test('the ELK engine places identically whichever ELK instance it is given', async () => {
  const info = getLayoutEngineInfo('elk-layered');
  const first = elkLayeredEngine({ ...info, direction: 'right', elk: new ELK() });
  const second = elkLayeredEngine({ ...info, direction: 'right', elk: new ELK() });
  const lazy = elkLayeredEngine({ ...info, direction: 'right', elk: () => new ELK() });
  for (const view of fixtureViews) {
    const expected = await layout(fixture, view, first);
    assert.deepEqual(await layout(fixture, view, second), expected);
    assert.deepEqual(await layout(fixture, view, lazy), expected);
    // And the registered engine, on whatever instance this environment provides.
    assert.deepEqual(await layout(fixture, view, getLayoutEngine('elk-layered')), expected);
  }
  const { model } = await loadDirectory('examples/delivery');
  for (const scene of [...model.scenes, showAllStructure(model, model.scenes[0])])
    assert.deepEqual(await layout(model, scene, second), await layout(model, scene, first));
});

test('the default engine is what an unnamed view gets, on every surface', async () => {
  const explicit = await layout(fixture, { ...base, expanded: ['core'], layout: 'elk-layered' });
  const implicit = await layout(fixture, { ...base, expanded: ['core'] });
  assert.equal(implicit.state.layout, undefined);
  assert.deepEqual({ ...explicit, state: implicit.state }, implicit);
  const run = (args: string[]): string =>
    execFileSync('node', ['--import', 'tsx', 'scripts/fractal.ts', ...args], {
      encoding: 'utf8',
      env: { ...process.env, FRACTAL_MODELS_DIR: 'examples', FRACTAL_CATALOG: '' }
    });
  const engines = JSON.parse(run(['engines', '--json'])) as { id: string }[];
  assert.deepEqual(
    engines.map((engine) => engine.id),
    LAYOUT_ENGINES.map((engine) => engine.id)
  );
  const flagged = JSON.parse(run(['layout', '--model', 'delivery', '--layout', 'elk-layered']));
  const plain = JSON.parse(run(['layout', '--model', 'delivery']));
  assert.equal(flagged.state.layout, 'elk-layered');
  assert.deepEqual({ ...flagged, state: plain.state }, plain);
  assert.throws(
    () =>
      execFileSync('node', ['--import', 'tsx', 'scripts/fractal.ts', 'layout', '--layout', 'x'], {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, FRACTAL_MODELS_DIR: 'examples', FRACTAL_CATALOG: '' }
      }),
    /Unknown layout engine/
  );
});

test('a scene may name its engine and the model rejects an unknown one', async () => {
  const { parseModel } = await import('../src/lib/adapters/likec4');
  const source = `specification { element service }\nmodel { a = service 'A' { metadata { uid 'a' } } }`;
  const companion = (layoutId: string) => ({
    version: 1,
    id: 'scenes',
    title: 'Scenes',
    description: '',
    provenance: 'test',
    boundaries: [],
    scenes: [
      {
        id: 'main',
        title: 'Main',
        description: '',
        expanded: [],
        proposed: false,
        lens: 'structure',
        layout: layoutId
      }
    ]
  });
  for (const id of LAYOUT_ENGINES.map((engine) => engine.id)) {
    const model = await parseModel(source, companion(id));
    assert.equal(model.scenes[0].layout, id);
  }
  await assert.rejects(parseModel(source, companion('bogus')), /Unknown layout engine: bogus/);
});
