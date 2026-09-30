import assert from 'node:assert/strict';
import test from 'node:test';
import { layout } from '../src/lib/core/layout';
import { revealOutside } from '../src/lib/core/navigation';
import { OUTSIDE_PORT_PREFIX, project } from '../src/lib/core/projection';
import { boundaryView } from '../src/lib/core/boundaries';
import { exportSvg } from '../src/lib/core/svg';
import type { Element, Model, Relationship, ViewState } from '../src/lib/core/types';

const element = (id: string, parent: string | null = null): Element => ({
  id,
  sourceId: id,
  parent,
  title: id,
  kind: 'service',
  description: '',
  technology: '',
  status: 'current',
  color: '#548573',
  evidence: []
});
const call = (id: string, source: string, target: string, title = id): Relationship => ({
  id,
  source,
  target,
  title,
  kind: 'calls',
  description: '',
  status: 'current'
});
const model: Model = {
  version: 1,
  id: 'scoped',
  title: 'Scoped',
  description: '',
  provenance: 'test',
  elements: [
    element('system'),
    element('subsystem', 'system'),
    element('inner', 'subsystem'),
    element('sibling', 'system'),
    element('sibling-child', 'sibling'),
    element('planner'),
    element('graph'),
    element('graph-api', 'graph'),
    element('database')
  ],
  relationships: [
    call('plan', 'planner', 'inner', 'plans'),
    call('plan-again', 'planner', 'inner', 'plans'),
    call('read', 'inner', 'sibling-child', 'reads'),
    call('write', 'inner', 'database', 'writes'),
    call('query', 'inner', 'graph-api', 'queries'),
    call('answer', 'graph-api', 'inner', 'answers'),
    call('inside', 'inner', 'inner', 'loops')
  ],
  boundaries: [],
  scenes: []
};
const scoped: ViewState = { expanded: [], proposed: false, lens: 'structure', scope: 'subsystem' };

test('a scoped view stands each outside endpoint in with one port', () => {
  const view = project(model, { ...scoped, expanded: ['subsystem'] });
  const byElement = Object.fromEntries((view.ports ?? []).map((port) => [port.element, port]));
  // The port is the child of the lowest shared ancestor on the outside endpoint's own path.
  assert.deepEqual(Object.keys(byElement).sort(), ['database', 'graph', 'planner', 'sibling']);
  assert.ok(view.ports!.every((port) => port.id === `${OUTSIDE_PORT_PREFIX}${port.element}`));
  assert.equal(byElement.planner.flow, 'in');
  assert.equal(byElement.sibling.flow, 'out');
  assert.equal(byElement.database.flow, 'out');
  assert.equal(byElement.graph.flow, 'both');
  assert.equal(byElement.planner.connections, 2);
  // Identical claims through one port bundle, the same as anywhere else.
  const plans = view.edges.filter((edge) => edge.source === byElement.planner.id);
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].underlying, ['plan', 'plan-again']);
  assert.equal(view.outside?.length, 6, 'the crossing inventory is unchanged');
});

test('context none keeps today’s tight focus, and an unscoped view never has ports', () => {
  const tight = project(model, { ...scoped, expanded: ['subsystem'], context: 'none' });
  assert.equal(tight.ports, undefined);
  assert.equal(tight.edges.length, 1);
  assert.equal(project(model, { ...scoped, scope: undefined }).ports, undefined);
  assert.throws(
    () => project(model, { ...scoped, context: 'sideways' as never }),
    /Invalid view state/
  );
});

test('summary mode counts the connections behind each port', () => {
  const view = project(model, { ...scoped, expanded: ['subsystem'], edges: 'summary' });
  const graph = view.edges.filter(
    (edge) => edge.source.includes('graph') || edge.target.includes('graph')
  );
  assert.equal(graph.length, 2, 'each direction keeps its own edge');
  assert.ok(graph.every((edge) => edge.underlying.length === 1 && !edge.rollup));
  const planner = view.edges.find((edge) => edge.source.endsWith('planner'))!;
  assert.equal(planner.title, '2 connections');
});

test('ports are laid out on the perimeter and draw as cards without becoming elements', async () => {
  const diagram = await layout(model, { ...scoped, expanded: ['subsystem'] });
  const ports = diagram.nodes.filter((node) => node.port);
  assert.equal(ports.length, 4);
  const inner = diagram.nodes.find((node) => node.id === 'subsystem')!;
  const planner = ports.find((node) => node.port!.element === 'planner')!;
  const database = ports.find((node) => node.port!.element === 'database')!;
  assert.ok(planner.x + planner.width <= inner.x, 'an input port sits before the scope');
  assert.ok(database.x >= inner.x + inner.width, 'an output port sits after the scope');
  assert.ok(
    ports.every((node) => node.parent === null && !model.elements.some((e) => e.id === node.id))
  );
  for (const edge of diagram.edges) assert.ok(edge.points.length >= 2);
  assert.deepEqual(diagram, await layout(model, { ...scoped, expanded: ['subsystem'] }));
  const svg = exportSvg(model, diagram);
  assert.equal((svg.match(/data-outside-port=/g) ?? []).length, 4);
  assert.match(svg, /outside scope/);
  assert.match(svg, /6 external connections drawn as outside ports/);
  assert.equal(
    (
      exportSvg(model, await layout(model, { ...scoped, context: 'none' })).match(
        /data-outside-port/g
      ) ?? []
    ).length,
    0
  );
});

test('ports never count as drawn elements for boundary membership', async () => {
  const withBoundary = {
    ...model,
    boundaries: [
      {
        id: 'b',
        title: 'B',
        description: '',
        kind: 'trust',
        members: ['planner'],
        color: '#123456'
      }
    ]
  };
  const diagram = await layout(withBoundary, { ...scoped, lens: 'trust' });
  assert.deepEqual(
    boundaryView(withBoundary, diagram).omitted.map((b) => b.id),
    ['b']
  );
});

test('revealing a port widens the scope to the shared ancestor and keeps the open path', () => {
  const state = { ...scoped, scope: 'inner', expanded: [] as string[] };
  const sibling = revealOutside(model, { ...scoped, scope: 'inner' }, 'sibling');
  assert.equal(sibling.state.scope, 'system');
  assert.deepEqual(sibling.state.expanded.sort(), ['subsystem', 'system']);
  assert.equal(sibling.target, 'sibling');
  const far = revealOutside(model, state, 'planner');
  assert.equal(far.state.scope, undefined);
  assert.deepEqual(far.state.expanded.sort(), ['subsystem', 'system']);
  const ancestor = revealOutside(model, state, 'subsystem');
  assert.equal(ancestor.state.scope, 'subsystem');
  assert.deepEqual(ancestor.state.expanded, ['subsystem'], 'the old scope stays visible inside it');
  const drawn = project(model, sibling.state).elements.map((e) => e.id);
  assert.ok(drawn.includes('sibling') && drawn.includes('inner'));
  assert.equal(
    revealOutside(model, { ...scoped, scope: undefined }, 'planner').state.scope,
    undefined
  );
});
