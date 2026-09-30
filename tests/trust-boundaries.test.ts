import assert from 'node:assert/strict';
import test from 'node:test';
import { boundaryView } from '../src/lib/core/boundaries';
import { layout } from '../src/lib/core/layout';
import { exportSvg } from '../src/lib/core/svg';
import type { Boundary, Element, Model, ViewState } from '../src/lib/core/types';

const element = (
  id: string,
  parent: string | null = null,
  status: Element['status'] = 'current'
): Element => ({
  id,
  sourceId: id,
  parent,
  title: id,
  kind: 'service',
  description: '',
  technology: '',
  status,
  color: '#548573',
  evidence: []
});
const boundary = (id: string, members: string[]): Boundary => ({
  id,
  title: `Boundary ${id}`,
  description: '',
  kind: 'trust',
  members,
  color: '#aa5533'
});
const model: Model = {
  version: 1,
  id: 'trust',
  title: 'Trust',
  description: '',
  provenance: 'test',
  elements: [
    element('service'),
    element('edge', 'service'),
    element('auth', 'edge'),
    element('worker', 'service'),
    element('graph'),
    element('api', 'graph'),
    element('future', 'service', 'proposed')
  ],
  relationships: [],
  boundaries: [
    boundary('mixed', ['auth', 'api']),
    boundary('exact', ['worker']),
    boundary('gone', ['api']),
    boundary('planned', ['future'])
  ],
  scenes: []
};
const state: ViewState = {
  expanded: ['service'],
  proposed: false,
  lens: 'trust',
  scope: 'service'
};

test('a boundary whose member sits inside a collapsed parent marks that parent', async () => {
  const diagram = await layout(model, state);
  const view = boundaryView(model, diagram);
  const mixed = view.present.find((entry) => entry.boundary.id === 'mixed')!;
  assert.deepEqual(mixed.exact, []);
  assert.deepEqual(mixed.contains, ['edge']);
  assert.deepEqual(
    view.byNode.get('edge')!.map((entry) => [entry.boundary.id, entry.kind]),
    [['mixed', 'contains']]
  );
  assert.deepEqual(
    view.byNode.get('worker')!.map((entry) => [entry.boundary.id, entry.kind]),
    [['exact', 'exact']]
  );
});

test('boundaries nothing in the view represents are counted as omitted, not silently dropped', async () => {
  const view = boundaryView(model, await layout(model, state));
  assert.deepEqual(
    view.omitted.map((entry) => entry.id),
    ['gone', 'planned']
  );
  const proposed = boundaryView(model, await layout(model, { ...state, proposed: true }));
  assert.deepEqual(
    proposed.omitted.map((entry) => entry.id),
    ['gone']
  );
});

test('expanding the parent turns containment into exact membership', async () => {
  const view = boundaryView(
    model,
    await layout(model, { ...state, expanded: ['service', 'edge'] })
  );
  const mixed = view.present.find((entry) => entry.boundary.id === 'mixed')!;
  assert.deepEqual(mixed.exact, ['auth']);
  assert.deepEqual(mixed.contains, []);
});

test('the SVG export shows contained members, a hollow legend marker and the omitted count', async () => {
  const svg = exportSvg(model, await layout(model, state));
  assert.match(svg, /data-contains-members="true"/);
  assert.match(svg, /Boundary mixed/);
  assert.match(svg, /fill="none" stroke="#aa5533" stroke-width="1.5"/);
  assert.match(svg, /2 BOUNDARIES NOT IN VIEW/);
  assert.match(svg, /DOTTED = CONTAINS MEMBERS/);
  const structure = exportSvg(model, await layout(model, { ...state, lens: 'structure' }));
  assert.doesNotMatch(structure, /data-contains-members|NOT IN VIEW/);
});
