import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModel } from '../src/lib/adapters/likec4';
import { layout } from '../src/lib/core/layout';
import { project } from '../src/lib/core/projection';
import type { Element, Model, Relationship, ViewState } from '../src/lib/core/types';

const element = (id: string): Element => ({
  id,
  sourceId: id,
  parent: null,
  title: id,
  kind: 'service',
  description: '',
  technology: '',
  status: 'current',
  color: '#548573',
  evidence: []
});
const relation = (
  id: string,
  source: string,
  target: string,
  extra: Partial<Relationship> = {}
): Relationship => ({
  id,
  source,
  target,
  title: id,
  kind: 'calls',
  description: '',
  status: 'current',
  ...extra
});
const loop = (feedback: boolean): Model => ({
  version: 1,
  id: 'loop',
  title: 'Loop',
  description: '',
  provenance: 'test',
  elements: ['filter', 'options', 'llm', 'rescope'].map(element),
  relationships: [
    relation('filter-options', 'filter', 'options'),
    relation('options-llm', 'options', 'llm'),
    relation('llm-rescope', 'llm', 'rescope'),
    relation('rescope-filter', 'rescope', 'filter', feedback ? { layoutFeedback: true } : {})
  ],
  boundaries: [],
  scenes: []
});
const state: ViewState = { expanded: [], proposed: false, lens: 'structure' };
const order = (diagram: Awaited<ReturnType<typeof layout>>, axis: 'x' | 'y'): string[] =>
  [...diagram.nodes].sort((a, b) => a[axis] - b[axis]).map((node) => node.id);

test('an unhinted cycle keeps reading in whatever order ELK breaks it', async () => {
  assert.notDeepEqual(order(await layout(loop(false), state), 'x'), [
    'filter',
    'options',
    'llm',
    'rescope'
  ]);
});

test('a layoutFeedback relationship is the edge a cycle reverses, in both flow directions', async () => {
  const expected = ['filter', 'options', 'llm', 'rescope'];
  assert.deepEqual(order(await layout(loop(true), state), 'x'), expected);
  assert.deepEqual(
    order(await layout(loop(true), { ...state, layout: 'elk-layered-down' }), 'y'),
    expected
  );
});

test('the hint never changes what is drawn or its meaning', async () => {
  const hinted = await layout(loop(true), state);
  const plain = await layout(loop(false), state);
  assert.deepEqual(
    hinted.edges.map(({ id, source, target, title }) => ({ id, source, target, title })),
    plain.edges.map(({ id, source, target, title }) => ({ id, source, target, title }))
  );
  assert.equal(hinted.edges.find((edge) => edge.id === 'rescope-filter')!.layoutFeedback, true);
  assert.equal(hinted.edges.find((edge) => edge.id === 'options-llm')!.layoutFeedback, undefined);
});

test('a rolled-up edge is feedback only when every claim behind it is', () => {
  const nested: Model = {
    ...loop(false),
    elements: [
      element('a'),
      { ...element('a1'), parent: 'a' },
      { ...element('a2'), parent: 'a' },
      element('b')
    ],
    relationships: [
      relation('one', 'a1', 'b', { layoutFeedback: true }),
      relation('two', 'a2', 'b', { layoutFeedback: true }),
      relation('three', 'a2', 'b', { title: 'other' })
    ]
  };
  const edges = project(nested, { ...state, edges: 'summary' }).edges;
  assert.equal(edges.length, 1);
  assert.equal(edges[0].layoutFeedback, undefined);
  const all = project(
    { ...nested, relationships: nested.relationships.slice(0, 2) },
    { ...state, edges: 'summary' }
  ).edges;
  assert.equal(all[0].layoutFeedback, true);
});

const companion = () => ({
  version: 1,
  id: 'sample',
  title: 'Sample',
  description: '',
  provenance: 'Authored test fixture',
  boundaries: [] as unknown[],
  scenes: [
    {
      id: 'overview',
      title: 'Overview',
      description: '',
      expanded: [] as string[],
      proposed: false,
      lens: 'structure'
    }
  ]
});
const source = (metadata: string) => `
 specification { element component relationship calls }
 model {
   a = component 'A'
   b = component 'B'
   b .calls a 'Feeds back' { metadata { uid 'back' ${metadata} } }
 }`;

test('layoutFeedback is authored as relationship metadata and validated', async () => {
  const flagged = await parseModel(source("layoutFeedback 'true'"), companion());
  assert.equal(flagged.relationships[0].layoutFeedback, true);
  const plain = await parseModel(source(''), companion());
  assert.equal('layoutFeedback' in plain.relationships[0], false);
  await assert.rejects(
    parseModel(source("layoutFeedback 'sometimes'"), companion()),
    /layoutFeedback/
  );
});
