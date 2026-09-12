import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareToBaseline,
  geometryFingerprint,
  geometryLines,
  measureSubject,
  parseBenchRows,
  percentile,
  qualityMetrics,
  syntheticModel,
  type BenchRow
} from '../src/lib/bench';
import { layout } from '../src/lib/adapters/elk-layout';
import { project } from '../src/lib/core/projection';
import { showAllStructure } from '../src/lib/core/navigation';
import { loadDirectory } from '../src/lib/server/models';
import type { Diagram, LayoutEdge, LayoutNode, ViewState } from '../src/lib/core/types';

const node = (id: string, x: number, y: number): LayoutNode => ({
  id,
  sourceId: id,
  parent: null,
  title: id,
  kind: 'service',
  description: '',
  technology: '',
  status: 'current',
  color: '#548573',
  evidence: [],
  x,
  y,
  width: 100,
  height: 50,
  expanded: false,
  titleLines: [id],
  kindLabel: 'Service',
  descriptionLines: [],
  depth: 0
});
const edge = (id: string, points: { x: number; y: number }[]): LayoutEdge => ({
  id,
  source: 'a',
  target: 'b',
  title: id,
  kind: 'calls',
  description: '',
  status: 'current',
  underlying: [id],
  points,
  label: points[Math.floor(points.length / 2)],
  labelLines: []
});
const state: ViewState = { expanded: [], proposed: false, lens: 'structure' };

/**
 * Two edges cross once in the middle; the third is a three-segment staircase that crosses
 * neither. Bends: the staircase turns twice, the straight edges never turn.
 */
const handBuilt: Diagram = {
  nodes: [node('a', 0, 0), node('b', 400, 0)],
  edges: [
    edge('flat', [
      { x: 0, y: 100 },
      { x: 200, y: 100 }
    ]),
    edge('cross', [
      { x: 100, y: 0 },
      { x: 100, y: 200 }
    ]),
    edge('stair', [
      { x: 300, y: 0 },
      { x: 300, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 200 }
    ])
  ],
  width: 400,
  height: 200,
  state
};

test('geometry fingerprint is stable across runs and moves with a coordinate', () => {
  assert.equal(geometryFingerprint(handBuilt), geometryFingerprint(handBuilt));
  assert.equal(geometryFingerprint(structuredClone(handBuilt)), geometryFingerprint(handBuilt));
  const moved = structuredClone(handBuilt);
  moved.nodes[1].x += 0.01;
  assert.notEqual(geometryFingerprint(moved), geometryFingerprint(handBuilt));
  const nudged = structuredClone(handBuilt);
  nudged.edges[0].points[1].y += 0.02;
  assert.notEqual(geometryFingerprint(nudged), geometryFingerprint(handBuilt));
  // Below the 0.01 rounding the fingerprint holds, so float noise never reads as a change.
  const noise = structuredClone(handBuilt);
  noise.nodes[0].x += 0.0001;
  assert.equal(geometryFingerprint(noise), geometryFingerprint(handBuilt));
  assert.equal(geometryLines(handBuilt)[0], 'node a 0.00 0.00 100.00 50.00');
});

test('quality metrics count crossings, bends and length on a known diagram', () => {
  const quality = qualityMetrics(handBuilt);
  assert.equal(quality.crossings, 1);
  assert.equal(quality.bends, 2);
  assert.equal(quality.edgeLength, 200 + 200 + 300);
  assert.equal(quality.area, 80000);
  assert.equal(quality.aspectRatio, 2);
  const straight = qualityMetrics({ ...handBuilt, edges: [handBuilt.edges[2]] });
  assert.equal(straight.crossings, 0);
  assert.equal(straight.bends, 2);
  // Touching at an endpoint is not a crossing: edges sharing a port always meet there.
  const touching = qualityMetrics({
    ...handBuilt,
    edges: [
      edge('one', [
        { x: 0, y: 0 },
        { x: 10, y: 0 }
      ]),
      edge('two', [
        { x: 10, y: 0 },
        { x: 10, y: 10 }
      ])
    ]
  });
  assert.equal(touching.crossings, 0);
});

test('percentiles use the nearest rank', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(percentile([5, 1, 3, 2, 4], 0.95), 5);
  assert.equal(percentile([], 0.5), 0);
});

test('the synthetic generator is deterministic and projects cleanly', async () => {
  for (const size of [3, 12, 60]) {
    const model = syntheticModel(size);
    assert.equal(model.elements.length, size);
    assert.deepEqual(model, syntheticModel(size));
    assert.equal(new Set(model.elements.map((item) => item.id)).size, size);
    assert.equal(
      new Set(model.relationships.map((item) => item.id)).size,
      model.relationships.length
    );
    const depths = model.elements.map((item) => {
      let depth = 0;
      let parent = item.parent;
      while (parent !== null) {
        depth++;
        parent = model.elements.find((other) => other.id === parent)!.parent;
      }
      return depth;
    });
    assert.equal(Math.max(...depths), 2, 'three levels');
    const projection = project(model, showAllStructure(model, model.scenes[0]));
    assert.equal(projection.elements.length, size);
    assert.ok(model.relationships.every((item) => item.source !== item.target));
  }
  assert.throws(() => syntheticModel(2), /at least 3/);
  assert.throws(() => syntheticModel(12.5), /whole number/);
  const geometry = geometryFingerprint(
    await layout(
      syntheticModel(12),
      showAllStructure(syntheticModel(12), syntheticModel(12).scenes[0])
    )
  );
  assert.match(geometry, /^[0-9a-f]{64}$/);
});

test('stage timing reports every stage a model reaches', async () => {
  const measured = await measureSubject(
    {
      load: () => loadDirectory('examples/delivery'),
      state,
      engine: 'elk-layered',
      title: 'Delivery'
    },
    1
  );
  for (const stage of ['load', 'project', 'layout', 'svg', 'sequence'] as const) {
    assert.ok(measured.stages[stage], `${stage} was not timed`);
    assert.ok(measured.stages[stage]!.p50 >= 0);
  }
  // The measure stage waits for the layout seam; reporting it as zero would be a false number.
  assert.equal(measured.stages.measure, undefined);
  assert.equal(measured.nodes, measured.diagram.nodes.length);
  assert.ok(measured.edges >= 0);
});

const row = (overrides: Partial<BenchRow> = {}): BenchRow => ({
  model: 'delivery',
  view: 'overview',
  engine: 'elk-layered',
  source: 'examples/delivery',
  nodes: 5,
  edges: 8,
  width: 100,
  height: 50,
  iterations: 5,
  stages: { load: { p50: 80, p95: 90, samples: 5 }, layout: { p50: 10, p95: 12, samples: 5 } },
  fingerprint: 'aaaa',
  quality: { crossings: 0, bends: 0, edgeLength: 0, area: 0, aspectRatio: 0 },
  commit: null,
  timestamp: '2026-09-11T00:00:00.000Z',
  ...overrides
});

test('baseline comparison reports deltas, a fingerprint change, and rows on one side only', () => {
  const baseline = [row(), row({ view: 'execution', fingerprint: 'cccc' })];
  const current = [
    row({
      fingerprint: 'bbbb',
      stages: { load: { p50: 4, p95: 5, samples: 5 }, layout: { p50: 11, p95: 12, samples: 5 } }
    }),
    row({ view: 'show-all', fingerprint: 'dddd' })
  ];
  const comparison = compareToBaseline(current, baseline);
  assert.equal(comparison.geometryChanged, true);
  const [changed, added, missing] = comparison.rows;
  assert.equal(changed.status, 'compared');
  assert.equal(changed.fingerprintChanged, true);
  assert.equal(changed.baselineFingerprint, 'aaaa');
  assert.equal(changed.stages.find((stage) => stage.stage === 'load')!.delta, -76);
  assert.equal(changed.stages.find((stage) => stage.stage === 'layout')!.delta, 1);
  assert.equal(added.status, 'added');
  assert.equal(added.fingerprintChanged, false);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.view, 'execution');
  assert.equal(compareToBaseline(baseline, baseline).geometryChanged, false);
});

test('baseline rows read back from JSONL and from a JSON document', () => {
  const rows = [row(), row({ view: 'execution' })];
  const jsonl = rows.map((item) => JSON.stringify(item)).join('\n') + '\n';
  assert.deepEqual(parseBenchRows(jsonl), rows);
  assert.deepEqual(parseBenchRows(JSON.stringify({ version: 1, rows }, null, 2)), rows);
  assert.throws(() => parseBenchRows('{"model":1}'), /fingerprint/);
});
