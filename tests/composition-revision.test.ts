import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseModel } from '../src/lib/adapters/likec4';
import { compose } from '../src/lib/composition/compose';
import {
  checkAdmission,
  DEFAULT_COMPOSITION_LIMITS,
  estimateBytes,
  type CompositionCounts
} from '../src/lib/composition/limits';
import {
  parseCompositionDiagnostic,
  parseCompositionState,
  parseLinks
} from '../src/lib/composition/parse';
import {
  isStale,
  nextGeneration,
  revisionChangedDiagnostic,
  revisionConflicts,
  sourceChangingDiagnostic
} from '../src/lib/composition/revision';
import type { ProjectSnapshot } from '../src/lib/composition/snapshot';
import { staticResolver } from '../src/lib/composition/snapshot';
import type { CompositionState, IdentityOrigins } from '../src/lib/composition/types';

test('revision conflicts report changed participants in model order and ignore the rest', () => {
  assert.deepEqual(revisionConflicts({ a: '1' }, { a: '1' }), []);
  assert.deepEqual(revisionConflicts({ b: '2', a: '1' }, { a: 'changed', b: 'changed' }), [
    { model: 'a', expected: '1', actual: 'changed' },
    { model: 'b', expected: '2', actual: 'changed' }
  ]);
  // A model the loader never resolved, or one this composition never loaded, cannot conflict.
  assert.deepEqual(revisionConflicts({ a: '1' }, {}), []);
  assert.deepEqual(revisionConflicts({}, { extra: '9' }), []);
});

test('revision diagnostics carry the recovery the studio acts on', () => {
  const changed = revisionChangedDiagnostic('plugin', 'host');
  assert.equal(changed.code, 'revision_changed');
  assert.equal(changed.ownerModel, 'host');
  assert.equal(changed.recovery, 'reload');
  assert.deepEqual(changed.target, { model: 'plugin' });
  assert.deepEqual(parseCompositionDiagnostic(changed), changed);

  const changing = sourceChangingDiagnostic('plugin', 'host');
  assert.equal(changing.code, 'source_changing');
  assert.equal(changing.recovery, 'retry');
  assert.deepEqual(changing.target, { model: 'plugin' });
  assert.deepEqual(parseCompositionDiagnostic(changing), changing);
});

test('generations discard only superseded responses', () => {
  assert.equal(nextGeneration(), 1);
  assert.equal(nextGeneration(4), 5);
  assert.equal(isStale(2, 5), true);
  assert.equal(isStale(5, 5), false);
  assert.equal(isStale(6, 5), false);
});

const zeroCounts: CompositionCounts = {
  projects: 0,
  loadedElements: 0,
  relationships: 0,
  visibleNodes: 0,
  visibleEdges: 0,
  sourceBytesPerProject: 0,
  cacheBytes: 0
};

test('default admission limits match the plan and admit an empty composition', () => {
  assert.deepEqual(DEFAULT_COMPOSITION_LIMITS, {
    projects: 20,
    loadedElements: 10_000,
    relationships: 20_000,
    visibleNodes: 500,
    visibleEdges: 1000,
    sourceBytesPerProject: 5 * 1024 * 1024,
    cacheBytes: 128 * 1024 * 1024
  });
  assert.deepEqual(checkAdmission(zeroCounts), []);
  assert.deepEqual(checkAdmission({ ...zeroCounts, visibleNodes: 500 }), []);
});

test('checkAdmission returns one budget_exceeded diagnostic per exceeded resource', () => {
  const diagnostics = checkAdmission(
    { ...zeroCounts, visibleNodes: 501 },
    DEFAULT_COMPOSITION_LIMITS,
    'host'
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'budget_exceeded');
  assert.equal(diagnostics[0].ownerModel, 'host');
  assert.equal(diagnostics[0].recovery, 'reduce');
  assert.deepEqual(diagnostics[0].budget, { resource: 'visible_nodes', actual: 501, limit: 500 });
  assert.deepEqual(parseCompositionDiagnostic(diagnostics[0]), diagnostics[0]);

  const crowded: CompositionCounts = {
    projects: 21,
    loadedElements: 10_001,
    relationships: 20_001,
    visibleNodes: 501,
    visibleEdges: 1001,
    sourceBytesPerProject: 5 * 1024 * 1024 + 1,
    cacheBytes: 128 * 1024 * 1024 + 1
  };
  const resources = checkAdmission(crowded).map((diagnostic) => diagnostic.budget!.resource);
  assert.deepEqual(resources, [
    'projects',
    'loaded_elements',
    'relationships',
    'visible_nodes',
    'visible_edges',
    'source_bytes',
    'cache_bytes'
  ]);

  const override = checkAdmission(
    { ...zeroCounts, projects: 21 },
    { ...DEFAULT_COMPOSITION_LIMITS, projects: 21 }
  );
  assert.deepEqual(override, []);
});

const fixture = (path: string) =>
  readFile(new URL(`./fixtures/linked-projects/${path}`, import.meta.url), 'utf8');
const json = async (path: string) => JSON.parse(await fixture(path));

async function snapshot(id: 'host' | 'plugin'): Promise<ProjectSnapshot> {
  const source = await fixture(`${id}/model.c4`);
  const model = await parseModel(source, await json(`${id}/fractal.json`));
  return {
    id,
    model,
    links: parseLinks(await json(`${id}/links.json`), id),
    origins: (await json(`${id}/identity-origins.expected.json`)) as IdentityOrigins,
    revision: createHash('sha256').update(`${id}:${source}`).digest('hex')
  };
}

function openState(): CompositionState {
  return parseCompositionState({
    version: 1,
    root: 'host',
    projects: [
      { model: 'host', scene: 'overview', mode: 'open', view: view() },
      { model: 'plugin', scene: 'overview', mode: 'open', view: view() }
    ],
    theme: 'grove',
    layout: 'elk-layered'
  });
}

const view = (expanded: string[] = []) => ({
  expanded,
  proposed: false,
  lens: 'structure' as const
});

test('estimateBytes is a deterministic positive approximation that grows with content', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const composed = await compose(staticResolver([host, plugin]), openState());

  assert.ok(estimateBytes(host) > 0);
  assert.equal(estimateBytes(host), estimateBytes(structuredClone(host)));
  assert.equal(estimateBytes(plugin), estimateBytes(structuredClone(plugin)));

  const diagram = composed.projects.find((project) => project.model === 'host')!.diagram!;
  assert.ok(estimateBytes(diagram) > 0);
  assert.equal(estimateBytes(diagram), estimateBytes(structuredClone(diagram)));

  assert.ok(estimateBytes(composed) > estimateBytes(diagram));
  assert.equal(estimateBytes(composed), estimateBytes(structuredClone(composed)));
});
