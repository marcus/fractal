import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutSequence } from '../src/lib/sequence/layout';
import {
  setParticipantVisibility,
  setPhaseVisibility,
  showAllPhases,
  visiblePhaseIds
} from '../src/lib/sequence/visibility';
import { exportSequenceSvg } from '../src/lib/sequence/svg';
import type {
  SequenceJourney,
  SequenceMessage,
  SequenceViewState
} from '../src/lib/sequence/types';

const message = (id: string): SequenceMessage => ({
  type: 'message',
  id,
  title: id,
  description: '',
  from: 'a',
  to: 'b',
  kind: 'call'
});
const journey: SequenceJourney = {
  id: 'test',
  title: 'Selection',
  description: '',
  provenance: '',
  status: 'current',
  groups: [],
  participants: ['a', 'b'].map((id) => ({ id, title: id, description: '', color: '#345678' })),
  steps: [
    message('unphased'),
    {
      type: 'phase',
      id: 'parent',
      title: 'Parent',
      description: '',
      steps: [
        message('parent-message'),
        {
          type: 'phase',
          id: 'child',
          title: 'Child',
          description: '',
          steps: [message('child-message')]
        }
      ]
    },
    { type: 'phase', id: 'peer', title: 'Peer', description: '', steps: [message('peer-message')] }
  ]
};
const view: SequenceViewState = {
  collapsedPhases: [],
  collapsedGroups: [],
  hiddenParticipants: []
};
const ids = (state: SequenceViewState) => layoutSequence(journey, state).rows.map((row) => row.id);

test('phase visibility toggles subtrees, isolates and restores all without changing folding', () => {
  const folded = { ...view, collapsedPhases: ['parent'] };
  const only = setPhaseVisibility(journey, folded, 'child', 'only');
  assert.deepEqual(visiblePhaseIds(journey, only), ['child']);
  assert.deepEqual(ids(only), ['parent', 'child', 'child-message']);
  assert.equal(layoutSequence(journey, only).rows[0].contextOnly, true);
  const some = setPhaseVisibility(journey, only, 'peer', 'toggle');
  assert.deepEqual(ids(some), ['parent', 'child', 'child-message', 'peer', 'peer-message']);
  const wholeParent = setPhaseVisibility(journey, only, 'parent', 'toggle');
  assert.deepEqual(wholeParent.visiblePhases, ['parent', 'child']);
  assert.deepEqual(ids(wholeParent), ['parent']); // Its folding preference is preserved.
  const all = setPhaseVisibility(journey, some, '', 'all');
  assert.deepEqual(all, folded);
  assert.ok(ids(all).includes('unphased'));
  assert.deepEqual(ids(setPhaseVisibility(journey, view, 'parent', 'only')), [
    'parent',
    'parent-message',
    'child',
    'child-message'
  ]);
});

test('exact filters preserve authored order and export only included interaction provenance', () => {
  const state = { ...view, visiblePhases: ['peer', 'child'] };
  const diagram = layoutSequence(journey, state);
  assert.deepEqual(ids(state), ['parent', 'child', 'child-message', 'peer', 'peer-message']);
  assert.deepEqual(diagram.rows[0].messageIds, ['child-message']);
  const svg = exportSequenceSvg(journey, diagram);
  assert.match(svg, /2 OF 4 INTERACTIONS/);
  assert.match(svg, / · context/);
  assert.doesNotMatch(svg, /data-message-ids="parent-message/);
  assert.deepEqual(ids({ ...view, visiblePhases: [] }), []);
  assert.equal(layoutSequence(journey, { ...state, hiddenParticipants: ['a'] }).hiddenMessages, 2);
});

test('legacy scope upgrades on edit and invalid filter combinations fail explicitly', () => {
  assert.deepEqual(visiblePhaseIds(journey, { ...view, scopePhase: 'removed' }), []);
  assert.throws(() => layoutSequence(journey, { ...view, scopePhase: 'removed' }), /unknown phase/);
  const legacy = { ...view, scopePhase: 'parent' };
  assert.deepEqual(visiblePhaseIds(journey, legacy), ['parent', 'child']);
  const next = setPhaseVisibility(journey, legacy, 'peer', 'toggle');
  assert.equal(next.scopePhase, undefined);
  assert.deepEqual(ids(next), ids(view));
  assert.throws(() => layoutSequence(journey, { ...legacy, visiblePhases: [] }), /either/);
  assert.throws(
    () => layoutSequence(journey, { ...view, visiblePhases: ['missing'] }),
    /unknown phase/
  );
  assert.throws(
    () => layoutSequence(journey, { ...view, visiblePhases: ['peer', 'peer'] }),
    /duplicate/
  );
  assert.throws(
    () =>
      layoutSequence(journey, { ...view, visiblePhases: 'peer' } as unknown as SequenceViewState),
    /array/
  );
});

test('show all reveals every phase and unfolds the journey without touching other state', () => {
  const state = {
    ...view,
    collapsedPhases: ['parent', 'elsewhere'],
    visiblePhases: ['child'],
    theme: 'grove' as const
  };
  assert.deepEqual(showAllPhases(journey, state), {
    ...view,
    collapsedPhases: ['elsewhere'],
    theme: 'grove'
  });
  assert.deepEqual(showAllPhases(journey, { ...view, scopePhase: 'parent' }), view);
});

test('participant visibility toggles lanes and groups, isolates, restores, and keeps one lane', () => {
  const grouped = {
    ...journey,
    participants: ['a', 'b', 'c'].map((id) => ({
      id,
      title: id,
      description: '',
      color: '#345678'
    })),
    groups: [{ id: 'g', title: 'Group', participants: ['a', 'b'] }]
  };
  const hiddenA = setParticipantVisibility(grouped, view, 'a', 'toggle')!;
  assert.deepEqual(hiddenA.hiddenParticipants, ['a']);
  // A partial group shows its remaining members before it hides them all.
  assert.deepEqual(
    setParticipantVisibility(grouped, hiddenA, 'g', 'toggle')!.hiddenParticipants,
    []
  );
  assert.deepEqual(setParticipantVisibility(grouped, view, 'g', 'toggle')!.hiddenParticipants, [
    'a',
    'b'
  ]);
  assert.deepEqual(setParticipantVisibility(grouped, view, 'c', 'only')!.hiddenParticipants, [
    'a',
    'b'
  ]);
  assert.deepEqual(setParticipantVisibility(grouped, view, 'g', 'only')!.hiddenParticipants, ['c']);
  assert.deepEqual(setParticipantVisibility(grouped, hiddenA, '', 'all')!.hiddenParticipants, []);
  const lastLane = { ...view, hiddenParticipants: ['a', 'b'] };
  assert.equal(setParticipantVisibility(grouped, lastLane, 'c', 'toggle'), null);
  assert.throws(
    () => setParticipantVisibility(grouped, view, 'unknown', 'toggle'),
    /Unknown participant/
  );
});
