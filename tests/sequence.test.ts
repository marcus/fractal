import assert from 'node:assert/strict';
import test from 'node:test';
import { textWidth } from '../src/lib/core/projection';
import type { Element } from '../src/lib/core/types';
import { layoutSequence, revealHiddenLanes } from '../src/lib/sequence/layout';
import { parseSequences } from '../src/lib/sequence/parse';
import { exportSequenceSvg } from '../src/lib/sequence/svg';
import { selfMessagePath, SELF_MESSAGE_LOOP_HEIGHT } from '../src/lib/sequence/metrics';

const element = (id: string, title: string, status: Element['status'] = 'current'): Element => ({
  id,
  sourceId: id,
  parent: null,
  title,
  kind: 'service',
  description: `${title} architecture description`,
  technology: '',
  status,
  color: id === 'api' ? '#267566' : '#647d72',
  evidence: []
});
const model = {
  elements: [
    element('user', 'Operator'),
    element('api', 'API'),
    element('worker', 'Worker'),
    element('future', 'Future', 'proposed')
  ]
};

const input = {
  version: 1,
  journeys: [
    {
      id: 'draft',
      title: 'Draft pull request',
      provenance: 'docs/operator.md',
      participants: [
        { id: 'operator', element: 'user' },
        { id: 'gateway', element: 'api' },
        { id: 'runner', element: 'worker' }
      ],
      groups: [{ id: 'workers', title: 'Execution workers', participants: ['gateway', 'runner'] }],
      steps: [
        { type: 'message', id: 'request', title: 'Request work', from: 'operator', to: 'gateway' },
        {
          type: 'phase',
          id: 'execute',
          title: 'Execute safely',
          steps: [
            {
              type: 'message',
              id: 'dispatch',
              title: 'Dispatch',
              from: 'gateway',
              to: 'runner',
              kind: 'async'
            },
            {
              type: 'phase',
              id: 'review',
              title: 'Independent review',
              description: 'Review exact candidate',
              steps: [
                {
                  type: 'message',
                  id: 'verdict',
                  title: 'Return verdict',
                  description: 'Structured approved verdict',
                  from: 'runner',
                  to: 'gateway',
                  kind: 'return'
                }
              ]
            },
            {
              type: 'message',
              id: 'publish',
              title: 'Publish draft',
              from: 'gateway',
              to: 'operator'
            }
          ]
        }
      ]
    }
  ]
};

test('strict parsing resolves architecture defaults and preserves arbitrary nested chronology', () => {
  const journey = parseSequences(input, model)[0];
  assert.deepEqual(journey.participants[1], {
    id: 'gateway',
    element: 'api',
    title: 'API',
    description: 'API architecture description',
    color: '#267566'
  });
  assert.equal(journey.description, '');
  assert.equal(journey.status, 'current');
  const nested = journey.steps[1];
  assert.equal(nested.type, 'phase');
  assert.deepEqual(nested.type === 'phase' ? nested.steps.map(({ id }) => id) : [], [
    'dispatch',
    'review',
    'publish'
  ]);
});

test('parser rejects unknown syntax, unstable references, overlapping/noncontiguous groups and current references to proposed architecture', () => {
  assert.throws(
    () => parseSequences({ ...input, surprise: true }, model),
    /surprise is unsupported/
  );
  const copy = () => structuredClone(input) as any;
  const unknown = copy();
  unknown.journeys[0].steps[0].from = 'missing';
  assert.throws(() => parseSequences(unknown, model), /unknown participant missing/);
  const duplicate = copy();
  duplicate.journeys[0].steps[0].id = 'execute';
  assert.throws(() => parseSequences(duplicate, model), /duplicates stable ID execute/);
  const reserved = copy();
  reserved.journeys[0].steps[0].id = 'summary:candidate';
  assert.throws(() => parseSequences(reserved, model), /must not use reserved summary: prefix/);
  const overlap = copy();
  overlap.journeys[0].groups.push({ id: 'again', title: 'Again', participants: ['runner'] });
  assert.throws(() => parseSequences(overlap, model), /duplicate ID runner/);
  const noncontiguous = copy();
  noncontiguous.journeys[0].groups[0].participants = ['operator', 'runner'];
  assert.throws(() => parseSequences(noncontiguous, model), /contiguous participant order/);
  const reversed = copy();
  reversed.journeys[0].groups[0].participants = ['runner', 'gateway'];
  assert.throws(() => parseSequences(reversed, model), /contiguous participant order/);
  const proposed = copy();
  proposed.journeys[0].participants[2].element = 'future';
  assert.throws(() => parseSequences(proposed, model), /is proposed but journey is current/);
  const semantic = copy();
  semantic.journeys[0].steps[0].type = 'parallel';
  assert.throws(() => parseSequences(semantic, model), /type must be message or phase/);
});

test('phase collapse and nested focus retain stable IDs, exact provenance and chronology', () => {
  const journey = parseSequences(input, model)[0];
  const collapsed = layoutSequence(journey, {
    collapsedPhases: ['execute'],
    collapsedGroups: [],
    hiddenParticipants: []
  });
  assert.deepEqual(
    collapsed.rows.map(({ id }) => id),
    ['request', 'execute']
  );
  assert.deepEqual(collapsed.rows[1].messageIds, ['dispatch', 'verdict', 'publish']);
  assert.equal(collapsed.rows[1].collapsed, true);
  const focused = layoutSequence(journey, {
    collapsedPhases: [],
    collapsedGroups: [],
    hiddenParticipants: [],
    scopePhase: 'review'
  });
  assert.deepEqual(
    focused.rows.map(({ id }) => id),
    ['review', 'verdict']
  );
  assert.equal(focused.rows[1].parent, 'review');
  assert.equal(focused.state.theme, 'grove');
});

test('collapsed groups combine only consecutive internal messages and retain external endpoints', () => {
  const journey = parseSequences(input, model)[0];
  const diagram = layoutSequence(journey, {
    collapsedPhases: [],
    collapsedGroups: ['workers'],
    hiddenParticipants: []
  });
  assert.deepEqual(
    diagram.columns.map(({ id }) => id),
    ['operator', 'workers']
  );
  assert.deepEqual(diagram.columns[1].memberIds, ['gateway', 'runner']);
  const internal = diagram.rows.filter(({ type }) => type === 'internal');
  assert.deepEqual(
    internal.map(({ id }) => id),
    ['summary:dispatch', 'summary:verdict']
  );
  assert.deepEqual(
    internal.flatMap(({ messageIds }) => messageIds),
    ['dispatch', 'verdict']
  );
  assert.deepEqual(diagram.rows.at(-1)?.participantIds, ['gateway', 'operator']);
});

test('hidden interactions remain explicit rows without fabricated endpoints and invalid view states fail', () => {
  const journey = parseSequences(input, model)[0];
  const diagram = layoutSequence(journey, {
    collapsedPhases: [],
    collapsedGroups: [],
    hiddenParticipants: ['gateway']
  });
  const hidden = diagram.rows.filter(({ type }) => type === 'hidden');
  assert.deepEqual(
    hidden.map(({ id }) => id),
    ['request', 'dispatch', 'verdict', 'publish']
  );
  assert.ok(hidden.every((row) => row.from === undefined && row.to === undefined));
  assert.equal(diagram.hiddenMessages, 4);
  assert.throws(
    () =>
      layoutSequence(journey, {
        collapsedPhases: [],
        collapsedGroups: [],
        hiddenParticipants: ['operator', 'gateway', 'runner']
      }),
    /cannot hide all/
  );
  assert.throws(
    () =>
      layoutSequence(journey, {
        collapsedPhases: ['missing'],
        collapsedGroups: [],
        hiddenParticipants: []
      }),
    /unknown phase/
  );
  assert.throws(() => layoutSequence(journey, null as unknown as never), /state must be an object/);
  assert.throws(
    () => layoutSequence(journey, { hiddenParticipants: 'gateway' } as unknown as never),
    /array of non-empty strings/
  );
  assert.throws(
    () =>
      layoutSequence(journey, {
        collapsedPhases: [],
        collapsedGroups: [],
        hiddenParticipants: [],
        scopePhase: ''
      }),
    /non-empty string/
  );
  assert.throws(
    () =>
      layoutSequence(journey, {
        collapsedPhases: [],
        collapsedGroups: [],
        hiddenParticipants: [],
        extra: true
      } as unknown as never),
    /extra is unsupported/
  );
});

test('dense diagrams grow their natural canvas and retain complete wrapped column titles', () => {
  const many = structuredClone(input) as any;
  many.journeys[0].participants = Array.from({ length: 12 }, (_, index) => ({
    id: `participant-${index}`,
    title: `Participant ${index} with a deliberately descriptive column heading`
  }));
  many.journeys[0].groups = [];
  many.journeys[0].steps = [
    {
      type: 'message',
      id: 'wide-message',
      title: 'Across the system',
      from: 'participant-0',
      to: 'participant-11'
    }
  ];
  const diagram = layoutSequence(parseSequences(many, model)[0]);
  assert.ok(diagram.width > 1920);
  assert.ok(diagram.columns.every(({ width }) => width >= 160));
  assert.ok(diagram.columns[0].titleLines.join(' ').includes('descriptive column heading'));
  assert.equal(new Set(diagram.columns.map(({ height }) => height)).size, 1);
  assert.equal(
    diagram.columns[0].height,
    25 + Math.max(...diagram.columns.map(({ titleLines }) => titleLines.length)) * 19
  );
  assert.ok(diagram.rows[0].y > 150);
});

test('participant headers use one compact height until a wrapped title needs more room', () => {
  const journey = parseSequences(input, model)[0];
  const compact = layoutSequence(journey, {
    collapsedPhases: [],
    collapsedGroups: ['workers'],
    hiddenParticipants: []
  });
  assert.deepEqual([...new Set(compact.columns.map(({ height }) => height))], [44]);

  const wrapped = structuredClone(input) as any;
  wrapped.journeys[0].participants[0].title =
    'Operator with a deliberately long participant title that must wrap';
  const expanded = layoutSequence(parseSequences(wrapped, model)[0]);
  assert.equal(new Set(expanded.columns.map(({ height }) => height)).size, 1);
  assert.ok(expanded.columns[0].height > compact.columns[0].height);
});

test('SVG is portable, escaped, provenance-complete and wrapped text fits allocated rows', () => {
  const escaped = structuredClone(input) as any;
  escaped.journeys[0].title = 'Draft <PR> & "review"';
  escaped.journeys[0].steps[0].title =
    'A very long request title that should wrap without escaping beyond the message label allocation <unsafe>';
  const journey = parseSequences(escaped, model)[0];
  const diagram = layoutSequence(journey);
  const svg = exportSequenceSvg(journey, diagram);
  assert.match(svg, /^<svg[^>]+width="1920" height="1080"/);
  assert.doesNotMatch(svg, /foreignObject|<unsafe>/);
  assert.match(svg, /Draft &lt;PR&gt; &amp; &quot;review&quot;/);
  assert.match(svg, /data-export-layer="title"/);
  assert.match(svg, /FRACTAL \/ SEQUENCE JOURNEY/);
  assert.match(svg, /data-export-layer="footer"/);
  assert.match(
    svg,
    /<path d="M[^\"]+" fill="none" stroke="#[0-9a-f]+" stroke-width="2"[^>]+marker-end="url\(#arrow/
  );
  assert.match(svg, /<marker id="arrow"/);
  assert.match(svg, /SOURCE · docs\/operator\.md/);
  const messageRow = diagram.rows.find(({ type }) => type === 'message')!;
  assert.ok(messageRow.arrowY! > (messageRow.descriptionY ?? messageRow.titleY));
  assert.match(svg, new RegExp(`H[^\"]+[^>]+marker-end="url\\(#arrow[^>]+`));
  assert.match(svg, /data-message-ids="dispatch"/);
  assert.match(svg, /&quot;messageIds&quot;:\[&quot;dispatch&quot;\]/);
  assert.ok(
    diagram.rows.every((row) =>
      row.titleLines.every((line) => textWidth(line, row.type === 'phase' ? 15 : 13) <= 960)
    )
  );
});

test('SVG bounds long presentation headings and phase labels while retaining full accessible text', () => {
  const long = structuredClone(input) as any;
  long.journeys[0].title = Array.from({ length: 35 }, (_, index) => `journey-${index}`).join(' ');
  long.journeys[0].description = Array.from({ length: 50 }, (_, index) => `context-${index}`).join(
    ' '
  );
  long.journeys[0].steps[1].title = Array.from({ length: 35 }, (_, index) => `phase-${index}`).join(
    ' '
  );
  const journey = parseSequences(long, model)[0];
  const diagram = layoutSequence(journey, {
    collapsedPhases: ['execute'],
    collapsedGroups: [],
    hiddenParticipants: []
  });
  const svg = exportSequenceSvg(journey, diagram);
  assert.match(svg, new RegExp(`<title id="sequence-title">${journey.title}</title>`));
  assert.match(svg, /journey-\d+…/);
  const visibleHeader = svg.match(/data-export-layer="title">([\s\S]*?)<\/g>/)![1];
  assert.ok((visibleHeader.match(/context-\d+/g) ?? []).length < 50);
  const phase = diagram.rows.find(({ id }) => id === 'execute')!;
  assert.ok(phase.titleLines.every((line) => textWidth(line, 15) <= diagram.width - 430));
});

test('hidden lane markers preserve authored runs, end positions, grouped holes and reveal semantics', () => {
  const journey = parseSequences(input, model)[0];
  const view = { collapsedPhases: [], collapsedGroups: [], hiddenParticipants: ['gateway'] };
  const diagram = layoutSequence(journey, view);
  assert.equal(diagram.gaps.length, 1);
  assert.deepEqual(diagram.gaps[0].participantIds, ['gateway']);
  assert.equal(diagram.gaps[0].left, 'operator');
  assert.equal(diagram.gaps[0].right, 'runner');
  assert.ok(diagram.gaps[0].x > diagram.columns[0].x + diagram.columns[0].width / 2);
  assert.ok(diagram.gaps[0].x < diagram.columns[1].x - diagram.columns[1].width / 2);
  assert.match(exportSequenceSvg(journey, diagram), /data-hidden-lanes="gateway"/);
  for (const hidden of [['operator'], ['runner'], ['operator', 'gateway']]) {
    const result = layoutSequence(journey, { ...view, hiddenParticipants: hidden });
    assert.deepEqual(
      result.gaps.flatMap((gap) => gap.participantIds),
      hidden
    );
    assert.ok(
      result.gaps.every(
        (gap) => gap.x - gap.width / 2 >= 0 && gap.x + gap.width / 2 <= result.width
      )
    );
  }
  const grouped = {
    ...journey,
    groups: [
      { id: 'all', title: 'All participants', participants: journey.participants.map((p) => p.id) }
    ]
  };
  const folded = layoutSequence(grouped, { ...view, collapsedGroups: ['all'] });
  assert.equal(folded.gaps[0].inside, 'all');
  assert.ok(folded.gaps[0].y >= folded.columns[0].y + folded.columns[0].height);
  const restored = revealHiddenLanes(grouped, folded.state, folded.gaps[0].participantIds);
  assert.deepEqual(restored.hiddenParticipants, []);
  assert.deepEqual(restored.collapsedGroups, []);
  assert.equal(layoutSequence(grouped, restored).columns.length, 3);
  assert.throws(() => revealHiddenLanes(grouped, folded.state, ['missing']), /Only hidden/);
});

test('phase headers fit title-only content and share left alignment across depth and folding', () => {
  const journey = parseSequences(input, model)[0];
  const open = layoutSequence(journey);
  const folded = layoutSequence(journey, {
    collapsedPhases: ['execute'],
    collapsedGroups: [],
    hiddenParticipants: []
  });
  const titleOnly = open.rows.find((row) => row.id === 'execute')!;
  const withSubtitle = open.rows.find((row) => row.id === 'review')!;
  assert.equal(titleOnly.height, 35);
  // A subtitle that fits beside its title costs no extra height.
  assert.equal(withSubtitle.height, titleOnly.height);
  assert.equal(titleOnly.titleX, withSubtitle.titleX);
  assert.equal(titleOnly.x, withSubtitle.x);
  assert.equal(titleOnly.width, withSubtitle.width);
  assert.equal(titleOnly.x, folded.rows.find((row) => row.id === 'execute')!.x);
  assert.equal(titleOnly.titleX, folded.rows.find((row) => row.id === 'execute')!.titleX);
});

test('nested phases export as underlined subheaders and self messages use rounded returns', () => {
  const journey = parseSequences(input, model)[0];
  const svg = exportSequenceSvg(journey, layoutSequence(journey));
  assert.match(svg, /data-row-type="phase" data-phase-depth="1"[^>]*>[\s\S]*?<line/);
  assert.equal(
    selfMessagePath(100, 200),
    'M 100 180 H 148 Q 154 180 154 186 V 194 Q 154 200 148 200 H 108'
  );
});

test('self-return loops clear measured labels without enlarging ordinary messages', () => {
  const journey = parseSequences(input, model)[0];
  const labels = [
    { title: 'Record acceptance', description: '' },
    { title: 'Record', description: 'Accepted' },
    {
      title: 'Bind repository, execution profile and authority for an isolated implementation',
      description: ''
    },
    {
      title: 'Validate authority',
      description:
        'Check the repository origin, permitted branch, execution profile and the complete draft-only authorization before proceeding with publication.'
    }
  ];
  journey.steps = labels.flatMap((label, index) => [
    {
      ...label,
      type: 'message' as const,
      kind: 'call' as const,
      id: `self-${index}`,
      from: 'gateway',
      to: 'gateway'
    },
    {
      ...label,
      type: 'message' as const,
      kind: 'call' as const,
      id: `ordinary-${index}`,
      from: 'gateway',
      to: 'runner'
    }
  ]);
  const diagram = layoutSequence(journey);
  const svg = exportSequenceSvg(journey, diagram);
  for (let index = 0; index < labels.length; index++) {
    const row = diagram.rows.find((candidate) => candidate.id === `self-${index}`)!;
    const ordinary = diagram.rows.find((candidate) => candidate.id === `ordinary-${index}`)!;
    const textBottom = Math.max(
      row.titleY + (row.titleLines.length - 1) * 19 + 7,
      row.descriptionLines.length
        ? row.descriptionY! + (row.descriptionLines.length - 1) * 15 + 6
        : 0
    );
    assert.ok(row.arrowY! - SELF_MESSAGE_LOOP_HEIGHT >= textBottom + 5, row.id);
    assert.equal(row.height, ordinary.height + SELF_MESSAGE_LOOP_HEIGHT);
    assert.ok(ordinary.y > row.arrowY!);
    const column = diagram.columns.find((column) => column.id === row.from)!;
    assert.ok(svg.includes(selfMessagePath(column.x, row.arrowY!)));
  }
});

test('a short subtitle shares its title baseline and a long one still wraps below it', () => {
  const journey = parseSequences(input, model)[0];
  const diagram = layoutSequence(journey);
  const phase = diagram.rows.find((row) => row.id === 'review')!;
  assert.equal(phase.titleDx, 0);
  assert.equal(phase.descriptionY, phase.titleY);
  // The gap allows for the measurement's own error, so a wider real title cannot collide.
  const phaseTitle = textWidth(phase.titleLines[0], 15);
  assert.equal(phase.descriptionDx, phaseTitle * 1.1 + 14);
  assert.ok(phase.descriptionDx! - phaseTitle >= 14);
  const message = diagram.rows.find((row) => row.id === 'verdict')!;
  assert.equal(message.descriptionY, message.titleY);
  // A subtitled message costs no more height than a bare one.
  assert.equal(message.height, diagram.rows.find((row) => row.id === 'publish')!.height);
  // Centred rows keep the pair centred: the two offsets straddle the label anchor.
  assert.ok(message.titleDx! < 0 && message.descriptionDx! > 0);
  const messageTitle = textWidth(message.titleLines[0], 13);
  assert.equal(
    Math.round(message.descriptionDx! - message.titleDx!),
    Math.round(
      (messageTitle + textWidth(message.descriptionLines[0], 11)) / 2 + 14 + messageTitle * 0.1
    )
  );

  const wordy =
    'A description long enough that it cannot share one line with its title and must wrap onto the line below it instead.';
  const edited = structuredClone(input);
  const execute = edited.journeys[0].steps[1] as {
    description?: string;
    steps: { description?: string; steps?: { description?: string }[] }[];
  };
  execute.description = wordy;
  execute.steps[1].steps![0].description = wordy;
  const revised = layoutSequence(parseSequences(edited, model)[0]);
  for (const id of ['execute', 'verdict']) {
    const stacked = revised.rows.find((row) => row.id === id)!;
    assert.equal(stacked.titleDx, undefined);
    assert.equal(stacked.descriptionDx, undefined);
    assert.ok(stacked.descriptionY! > stacked.titleY);
    assert.ok(stacked.height > diagram.rows.find((row) => row.id === id)!.height);
  }
});

test('message and omission labels wrap to the plate the renderers actually draw', () => {
  const journey = parseSequences(input, model)[0];
  const diagram = layoutSequence(journey, {
    collapsedPhases: [],
    collapsedGroups: [],
    hiddenParticipants: ['runner']
  });
  // Neighbouring lanes sit closer than the 360-wide label; the text still uses the plate.
  const near = diagram.rows.find((row) => row.id === 'request')!;
  const far = diagram.rows.find((row) => row.id === 'publish')!;
  for (const row of [near, far])
    assert.ok(row.titleLines.every((line) => textWidth(line, 13) <= 330));
  const omitted = diagram.rows.find((row) => row.id === 'dispatch')!;
  assert.equal(omitted.type, 'hidden');
  assert.ok(omitted.titleLines.every((line) => textWidth(line, 13) <= 640));
});

test('folding a phase preserves hidden interaction disclosure and scoped totals', () => {
  const journey = parseSequences(input, model)[0];
  const state = {
    collapsedPhases: ['execute'],
    collapsedGroups: ['workers'],
    hiddenParticipants: ['runner']
  };
  const folded = layoutSequence(journey, state);
  const open = layoutSequence(journey, { ...state, collapsedPhases: [] });
  assert.equal(folded.hiddenMessages, open.hiddenMessages);
  const phase = folded.rows.find((row) => row.id === 'execute')!;
  assert.ok(phase.hiddenMessageIds.includes('dispatch'));
  assert.ok(phase.hiddenMessageIds.includes('verdict'));
  assert.match(exportSequenceSvg(journey, folded), /hidden · collapsed/);
  const focused = layoutSequence(journey, {
    ...state,
    scopePhase: 'review',
    collapsedPhases: ['review']
  });
  assert.equal(focused.hiddenMessages, 1);
  assert.deepEqual(focused.rows[0].hiddenMessageIds, ['verdict']);
});
