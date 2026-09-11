import assert from 'node:assert/strict';
import test from 'node:test';
import { revealSearchResult, searchModel, type SearchResult } from '../src/lib/core/search';
import type { Model, ViewState } from '../src/lib/core/types';

const model: Model = {
  version: 1,
  id: 'search-fixture',
  title: 'Search fixture',
  description: '',
  provenance: 'Test fixture',
  boundaries: [],
  elements: [
    {
      id: 'payments',
      sourceId: 'payments',
      parent: null,
      title: 'Payments Platform',
      kind: 'system',
      description: 'Coordinates money movement.',
      technology: '',
      status: 'current',
      color: '#739886',
      evidence: []
    },
    {
      id: 'payments.ledger',
      sourceId: 'payments.ledger',
      parent: 'payments',
      title: 'Ledger Writer',
      kind: 'component',
      description: 'Persists balanced entries.',
      technology: 'Ruby',
      status: 'current',
      color: '#739886',
      evidence: []
    },
    {
      id: 'payments.region',
      sourceId: 'payments.region',
      parent: 'payments',
      title: 'Regional Processing',
      kind: 'subsystem',
      description: 'Groups one processing region.',
      technology: '',
      status: 'current',
      color: '#739886',
      evidence: []
    },
    {
      id: 'payments.region.worker',
      sourceId: 'payments.region.worker',
      parent: 'payments.region',
      title: 'Regional Worker',
      kind: 'component',
      description: 'Processes local entries.',
      technology: 'Ruby',
      status: 'current',
      color: '#739886',
      evidence: []
    },
    {
      id: 'future',
      sourceId: 'future',
      parent: null,
      title: 'Future Services',
      kind: 'system',
      description: 'Proposed architecture.',
      technology: '',
      status: 'proposed',
      color: '#739886',
      evidence: []
    },
    {
      id: 'future.audit',
      sourceId: 'future.audit',
      parent: 'future',
      title: 'Audit Store',
      kind: 'store',
      description: 'Keeps an immutable record.',
      technology: 'JSONL',
      status: 'proposed',
      color: '#739886',
      evidence: []
    },
    {
      id: 'notes',
      sourceId: 'notes',
      parent: null,
      title: 'Operator Notes',
      kind: 'store',
      description: 'Mentions the audit store in prose.',
      technology: '',
      status: 'current',
      color: '#739886',
      evidence: []
    }
  ],
  relationships: [
    {
      id: 'ledger-audit',
      source: 'payments.ledger',
      target: 'future.audit',
      title: 'Publishes entries',
      kind: 'writes',
      description: 'Keeps the compliance trail.',
      status: 'proposed'
    }
  ],
  scenes: [
    {
      id: 'overview',
      title: 'Overview',
      description: 'The whole system.',
      expanded: [],
      proposed: false,
      lens: 'structure'
    },
    {
      id: 'future-scene',
      title: 'Future audit flow',
      description: 'The proposed ledger trail.',
      expanded: ['future'],
      proposed: true,
      lens: 'trust',
      scope: 'future'
    }
  ]
};

test('search covers hidden and proposed authored identities with useful ranking', () => {
  const snapshot = structuredClone(model);
  const exact = searchModel(model, 'audit store');
  assert.equal(exact[0].id, 'future.audit');
  assert.equal(exact[0].status, 'proposed');
  assert.ok(exact.some((result) => result.id === 'notes'));
  assert.equal(searchModel(model, 'LEDGER write')[0].id, 'payments.ledger');
  assert.deepEqual(model, snapshot);
});

test('relationship endpoint names are searchable and rendered in the result', () => {
  const [result] = searchModel(model, 'ledger audit');
  assert.equal(result.id, 'ledger-audit');
  assert.equal(result.type, 'relationship');
  assert.match(result.description, /Ledger Writer → Audit Store/);
});

test('empty search returns scenes then root components and observes a bounded limit', () => {
  assert.deepEqual(
    searchModel(model, '').map(({ id, type }) => `${type}:${id}`),
    ['scene:overview', 'scene:future-scene', 'element:payments', 'element:future', 'element:notes']
  );
  assert.deepEqual(
    searchModel(model, '', 2).map((result) => result.id),
    ['overview', 'future-scene']
  );
  assert.deepEqual(searchModel(model, 'audit', 0), []);
});

test('revealing elements expands ancestors, enables proposals, and clears incompatible scope', () => {
  const view: ViewState = {
    expanded: [],
    proposed: false,
    lens: 'structure',
    scope: 'payments',
    theme: 'midnight'
  };
  const result = searchModel(model, 'audit store')[0];
  const revealed = revealSearchResult(model, view, result);
  assert.deepEqual(revealed.selected, { id: 'future.audit', type: 'element' });
  assert.equal(revealed.view.scope, undefined);
  assert.equal(revealed.view.proposed, true);
  assert.ok(revealed.view.expanded.includes('future'));
  assert.equal(revealed.view.theme, 'midnight');
  assert.deepEqual(view.expanded, []);
});

test('revealing a relationship exposes both exact endpoints and keeps its authored ID', () => {
  const result = searchModel(model, 'publishes')[0];
  const revealed = revealSearchResult(
    model,
    { expanded: [], proposed: false, lens: 'structure', scope: 'payments' },
    result
  );
  assert.deepEqual(revealed.selected, { id: 'ledger-audit', type: 'relationship' });
  assert.equal(revealed.view.scope, undefined);
  assert.equal(revealed.view.proposed, true);
  assert.deepEqual(revealed.view.expanded, ['payments', 'future']);
});

test('reveal normalizes expansion ancestry when retaining or clearing a nested scope', () => {
  const worker = searchModel(model, 'regional worker')[0];
  const retained = revealSearchResult(
    model,
    {
      expanded: ['payments', 'payments.region'],
      proposed: false,
      lens: 'structure',
      scope: 'payments.region'
    },
    worker
  );
  assert.equal(retained.view.scope, 'payments.region');
  assert.deepEqual(retained.view.expanded, ['payments.region']);

  const audit = searchModel(model, 'audit store')[0];
  const cleared = revealSearchResult(
    model,
    {
      expanded: ['payments.region'],
      proposed: false,
      lens: 'structure',
      scope: 'payments.region'
    },
    audit
  );
  assert.equal(cleared.view.scope, undefined);
  assert.deepEqual(cleared.view.expanded, ['payments', 'payments.region', 'future']);
});

test('revealing a scene clones its state and retains an existing theme when absent', () => {
  const result: SearchResult = {
    id: 'future-scene',
    type: 'scene',
    title: 'Future audit flow',
    description: 'The proposed ledger trail.'
  };
  const revealed = revealSearchResult(
    model,
    { expanded: [], proposed: false, lens: 'structure', theme: 'graphite' },
    result
  );
  assert.equal(revealed.selected, null);
  assert.deepEqual(revealed.view, {
    expanded: ['future'],
    proposed: true,
    lens: 'trust',
    scope: 'future',
    theme: 'graphite'
  });
  revealed.view.expanded.push('payments');
  assert.deepEqual(model.scenes[1].expanded, ['future']);
});

test('reveal rejects stale result identities', () => {
  assert.throws(
    () =>
      revealSearchResult(
        model,
        { expanded: [], proposed: false, lens: 'structure' },
        {
          id: 'missing',
          type: 'relationship',
          title: 'Missing',
          description: ''
        }
      ),
    /Unknown relationship/
  );
});
