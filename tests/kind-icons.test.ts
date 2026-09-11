import assert from 'node:assert/strict';
import test from 'node:test';
import { kindHint, kindIcon, kindTitle } from '../src/lib/core/kind-icons';

test('kinds map to icons by whole name, last word, then a fallback', () => {
  assert.equal(kindIcon('component').name, 'component');
  assert.equal(kindIcon('Data Store').name, 'database');
  assert.equal(kindIcon('event_source').name, 'source');
  assert.equal(kindIcon('something_unknown').name, 'element');
  assert.match(kindIcon('agent').markup, /stroke="currentColor"/);
  assert.equal(kindHint('something_unknown'), 'An element kind this model declares.');
});

test('kind titles read as sentence case and lead with proposed', () => {
  assert.equal(kindTitle('component'), 'Component');
  assert.equal(kindTitle('data_store', 'current'), 'Data store');
  assert.equal(kindTitle('adapter', 'proposed'), 'Proposed adapter');
});

test('primary kinds have distinct glyphs while semantic aliases share them', () => {
  const kinds = [
    'component',
    'subsystem',
    'system',
    'service',
    'adapter',
    'store',
    'source',
    'agent',
    'experience',
    'cli',
    'library',
    'workflow',
    'worker',
    'actor',
    'external',
    'something_unknown'
  ];
  const icons = kinds.map(kindIcon);
  assert.equal(new Set(icons.map((icon) => icon.markup)).size, kinds.length);
  for (const [kind, alias] of [
    ['component', 'module'],
    ['store', 'database'],
    ['experience', 'ui'],
    ['cli', 'tool'],
    ['workflow', 'pipeline'],
    ['worker', 'process'],
    ['actor', 'person'],
    ['actor', 'user']
  ]) {
    assert.deepEqual(kindIcon(kind), kindIcon(alias));
  }
});

test('inspector selections beyond elements have their own glyphs and readings', () => {
  const selections = [
    'relationship',
    'context',
    'Phase',
    'call',
    'return',
    'async',
    'Internal interactions',
    'Omitted interactions',
    'Participant',
    'Participant group'
  ];
  const icons = selections.map(kindIcon);
  assert.equal(new Set(icons.map((icon) => icon.markup)).size, selections.length);
  assert.ok(icons.every((icon) => icon.name !== 'element'));
  assert.deepEqual(kindIcon('Interaction'), kindIcon('call'));
  assert.equal(kindTitle('Participant group'), 'Participant group');
  assert.equal(kindHint('Omitted interactions'), 'Interactions hidden by participant visibility.');
});
