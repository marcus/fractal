import test from 'node:test';
import assert from 'node:assert/strict';
import { directionalNeighbor, outwardView } from '../src/lib/core/navigation';
import { loadModel } from '../src/lib/server/models';
import { layout } from '../src/lib/core/layout';

test('spatial navigation follows geometry and retains focus at an edge', async () => {
  const { model } = await loadModel('delivery');
  const diagram = await layout(model, { expanded: [], proposed: false, lens: 'structure' });
  const start = directionalNeighbor(diagram.nodes, null, 'right')!;
  const right = directionalNeighbor(diagram.nodes, start, 'right')!;
  assert.notEqual(right, start);
  assert.ok(
    diagram.nodes.find((n) => n.id === right)!.x > diagram.nodes.find((n) => n.id === start)!.x
  );
  const farRight = [...diagram.nodes].sort((a, b) => b.x - a.x)[0];
  assert.equal(directionalNeighbor(diagram.nodes, farRight.id, 'right'), farRight.id);
  assert.equal(directionalNeighbor([], null, 'down'), null);
});

test('spatial navigation follows a stacked arrangement as readily as a wide one', async () => {
  const { model } = await loadModel('delivery');
  const diagram = await layout(model, {
    expanded: [],
    proposed: false,
    lens: 'structure',
    layout: 'elk-layered-down'
  });
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const top = [...diagram.nodes].sort((a, b) => a.y - b.y)[0];
  const below = directionalNeighbor(diagram.nodes, top.id, 'down')!;
  assert.notEqual(below, top.id);
  assert.ok(byId.get(below)!.y > top.y, 'down reaches a node further down the flow');
  assert.equal(directionalNeighbor(diagram.nodes, below, 'up'), top.id, 'and up comes back');
  const bottom = [...diagram.nodes].sort((a, b) => b.y - a.y)[0];
  assert.equal(directionalNeighbor(diagram.nodes, bottom.id, 'down'), bottom.id);
});

test('Escape collapses a parent or leaves a focused scope without losing theme', async () => {
  const { model } = await loadModel('delivery');
  const state = {
    expanded: ['core', 'core.floor'],
    proposed: false,
    lens: 'structure' as const,
    theme: 'midnight' as const
  };
  const child = model.elements.find((e) => e.parent === 'core')!;
  const next = outwardView(model, state, child.id);
  assert.equal(next.target, 'core');
  assert.deepEqual(next.state.expanded, []);
  assert.equal(next.state.theme, 'midnight');
  const outside = outwardView(model, { ...state, scope: 'core' }, 'core');
  assert.equal(outside.state.scope, undefined);
  assert.equal(outside.target, 'core');
  assert.deepEqual(state.expanded, ['core', 'core.floor']);
});

test('show all expands eligible structure within scope and preserves view choices', async () => {
  const { showAllStructure } = await import('../src/lib/core/navigation');
  const { project } = await import('../src/lib/core/projection');
  const { model } = await loadModel('delivery');
  const state = {
    expanded: [],
    proposed: false,
    lens: 'trust' as const,
    theme: 'midnight' as const,
    scope: 'core'
  };
  const shown = showAllStructure(model, state);
  const visible = project(model, shown).elements;
  assert.ok(visible.length > 1);
  assert.equal(shown.scope, 'core');
  assert.equal(shown.theme, 'midnight');
  assert.equal(shown.lens, 'trust');
  assert.equal(shown.proposed, false);
  assert.deepEqual(state.expanded, []);
  assert.ok(visible.every((e) => e.status === 'current'));
  assert.ok(shown.expanded.every((id) => visible.some((e) => e.parent === id)));
  assert.ok(!shown.expanded.includes('intake'));
  assert.deepEqual(showAllStructure(model, shown), shown);
  const proposed = showAllStructure(model, { expanded: [], proposed: true, lens: 'structure' });
  assert.equal(project(model, proposed).elements.length, model.elements.length);
});
