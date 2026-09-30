import assert from 'node:assert/strict';
import test from 'node:test';
import { project } from '../src/lib/core/projection';
import { measure } from '../src/lib/core/measure';
import { layout } from '../src/lib/core/layout';
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
  id: 'summary',
  title: 'Summary',
  description: '',
  provenance: 'test',
  elements: [
    element('service'),
    element('a', 'service'),
    element('b', 'service'),
    element('platform'),
    element('db', 'platform'),
    element('queue', 'platform'),
    element('cache', 'platform')
  ],
  relationships: [
    call('r1', 'a', 'db', 'reads'),
    call('r2', 'a', 'queue', 'enqueues'),
    call('r3', 'b', 'cache', 'looks up'),
    call('r4', 'b', 'db', 'writes'),
    call('r5', 'service', 'platform', 'deploys to')
  ],
  boundaries: [],
  scenes: []
};
const collapsed: ViewState = { expanded: [], proposed: false, lens: 'structure' };

test('detail mode keeps every distinct claim between collapsed elements', () => {
  const { edges } = project(model, collapsed);
  assert.equal(edges.length, 5);
  assert.ok(edges.every((edge) => !edge.rollup));
});

test('summary mode draws one counted edge per collapsed pair and keeps every claim underneath', () => {
  const { edges } = project(model, { ...collapsed, edges: 'summary' });
  assert.equal(edges.length, 1);
  const [edge] = edges;
  assert.equal(edge.title, '5 connections');
  assert.equal(edge.rollup, true);
  assert.equal(edge.source, 'service');
  assert.equal(edge.target, 'platform');
  assert.deepEqual(edge.underlying.sort(), ['r1', 'r2', 'r3', 'r4', 'r5']);
  const [measured] = measure(project(model, { ...collapsed, edges: 'summary' })).edges;
  assert.deepEqual(measured.labelLines, ['5 connections']);
});

test('summary mode leaves exactly visible pairs and single claims alone', () => {
  const open = project(model, {
    ...collapsed,
    expanded: ['service', 'platform'],
    edges: 'summary'
  });
  // Every endpoint is drawn, so nothing is rolled up, and the parent-level claim keeps its title.
  assert.equal(open.edges.length, 5);
  assert.ok(open.edges.every((edge) => !edge.rollup));
  const half = project(model, { ...collapsed, expanded: ['platform'], edges: 'summary' });
  // `service` is collapsed and reaches three platform children plus itself: three claims from a
  // (rolled to service) merge per target, and single-claim pairs keep their original title.
  const byTarget = Object.fromEntries(half.edges.map((edge) => [edge.target, edge]));
  assert.equal(byTarget.db.title, '2 connections');
  assert.deepEqual(byTarget.db.underlying.sort(), ['r1', 'r4']);
  assert.equal(byTarget.queue.title, 'enqueues');
  assert.equal(byTarget.queue.rollup, undefined);
  assert.equal(byTarget.platform.title, 'deploys to');
});

test('proposed claims summarize apart from current ones, and bad values are rejected', () => {
  const mixed: Model = {
    ...model,
    relationships: [
      ...model.relationships,
      { ...call('r6', 'a', 'cache', 'plans'), status: 'proposed' },
      { ...call('r7', 'b', 'queue', 'plans'), status: 'proposed' }
    ]
  };
  const { edges } = project(mixed, { ...collapsed, proposed: true, edges: 'summary' });
  assert.deepEqual(edges.map((edge) => [edge.status, edge.underlying.length]).sort(), [
    ['current', 5],
    ['proposed', 2]
  ]);
  assert.throws(
    () => project(model, { ...collapsed, edges: 'bogus' as never }),
    /Invalid view state/
  );
});

test('a summarized layout is deterministic and draws fewer edges', async () => {
  const state: ViewState = { ...collapsed, edges: 'summary' };
  const diagram = await layout(model, state);
  assert.equal(diagram.edges.length, 1);
  assert.equal(diagram.state.edges, 'summary');
  assert.deepEqual(diagram, await layout(model, state));
});
