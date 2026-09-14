import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseModel } from '../src/lib/adapters/likec4';
import { parseCompositionState, parseLinks } from '../src/lib/composition/parse';
import { searchComposition, type CompositionSearchResult } from '../src/lib/composition/search';
import type { ProjectSnapshot } from '../src/lib/composition/snapshot';
import type { CompositionState, IdentityOrigins } from '../src/lib/composition/types';

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

const view = (expanded: string[] = []) => ({
  expanded,
  proposed: false,
  lens: 'structure' as const
});

function stateOf(models: string[]): CompositionState {
  return parseCompositionState({
    version: 1,
    root: 'host',
    projects: models.map((model) => ({ model, scene: 'overview', mode: 'open', view: view() })),
    theme: 'grove',
    layout: 'elk-layered'
  });
}

function ordered(results: CompositionSearchResult[]): boolean {
  for (let index = 1; index < results.length; index++) {
    const prior = results[index - 1];
    const next = results[index];
    const rank =
      prior.score - next.score ||
      (prior.model < next.model ? -1 : prior.model > next.model ? 1 : 0);
    if (rank > 0) return false;
    if (rank === 0 && prior.id > next.id) return false;
  }
  return true;
}

test('an unopened link is searchable as link metadata without loading its target', async () => {
  const host = await snapshot('host');
  const snapshots = new Map([['host', host]]);
  const results = searchComposition(snapshots, stateOf(['host']), 'beacon');
  const link = results.find((result) => result.kind === 'link');
  assert.ok(link, 'expected a link metadata result');
  assert.equal(link.model, 'plugin');
  assert.equal(link.owner, 'host');
  assert.equal(link.linkId, 'plugin');
  assert.equal(link.title, 'Beacon architecture');
  assert.deepEqual(link.target, { model: 'plugin', scene: 'overview' });
  assert.deepEqual(link.selection, { kind: 'element', model: 'host', element: 'cli' });
  assert.deepEqual(link.reveal, { model: 'host', expanded: [] });
  assert.ok(!results.some((result) => result.model === 'plugin' && result.kind !== 'link'));
});

test('a root-level link without a source element selects its owning project', async () => {
  const host = await snapshot('host');
  const results = searchComposition(new Map([['host', host]]), stateOf(['host']), 'unregistered');
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'link');
  assert.equal(results[0].id, 'unavailable');
  assert.deepEqual(results[0].selection, { kind: 'project', model: 'host' });
});

test('loaded targets are searched as models, never as link metadata', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const snapshots = new Map([
    ['host', host],
    ['plugin', plugin]
  ]);
  const results = searchComposition(snapshots, stateOf(['host', 'plugin']), 'beacon');
  assert.ok(!results.some((result) => result.kind === 'link'));
  assert.ok(results.some((result) => result.model === 'plugin' && result.kind === 'element'));
});

test('element hits carry qualified selections and reveal hints that mount ancestors', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const snapshots = new Map([
    ['host', host],
    ['plugin', plugin]
  ]);
  const results = searchComposition(snapshots, stateOf(['host', 'plugin']), 'plugin cli');
  const models = new Set(results.map((result) => result.model));
  assert.deepEqual(models, new Set(['host', 'plugin']));
  for (const result of results.filter(
    (candidate) => candidate.kind === 'element' && candidate.id === 'cli'
  )) {
    assert.deepEqual(result.selection, { kind: 'element', model: result.model, element: 'cli' });
    assert.equal(result.reveal.model, result.model);
    assert.ok(result.reveal.expanded.includes('core'), 'reveal mounts the collapsed ancestor');
  }
  assert.ok(ordered(results), 'results order by score, then model, then id');
});

test('relationships, boundaries and scenes qualify by model', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const snapshots = new Map([
    ['host', host],
    ['plugin', plugin]
  ]);
  const state = stateOf(['host', 'plugin']);

  const relationships = searchComposition(snapshots, state, 'reads state');
  assert.equal(relationships.filter((result) => result.kind === 'relationship').length, 2);
  for (const result of relationships.filter((candidate) => candidate.kind === 'relationship')) {
    assert.deepEqual(result.selection, {
      kind: 'relationship',
      model: result.model,
      relationship: 'call'
    });
  }

  const boundaries = searchComposition(snapshots, state, 'permissions');
  assert.equal(boundaries.filter((result) => result.kind === 'boundary').length, 2);
  for (const result of boundaries.filter((candidate) => candidate.kind === 'boundary')) {
    assert.equal(result.id, 'trust');
    assert.deepEqual(result.selection, {
      kind: 'boundary',
      model: result.model,
      boundary: 'trust'
    });
    assert.deepEqual(result.reveal, { model: result.model, expanded: [] });
  }

  const scenes = searchComposition(snapshots, state, 'overview');
  for (const model of ['host', 'plugin']) {
    const scene = scenes.find((result) => result.model === model && result.kind === 'scene');
    assert.ok(scene, `expected an overview scene hit for ${model}`);
    assert.deepEqual(scene.selection, { kind: 'scene', model, scene: 'overview' });
  }
  assert.ok(ordered(scenes));
});

test('only participating snapshots are searched', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const snapshots = new Map([
    ['host', host],
    ['plugin', plugin]
  ]);
  const results = searchComposition(snapshots, stateOf(['host']), 'reads plugin state');
  assert.ok(results.length > 0);
  assert.ok(results.every((result) => result.model === 'host' || result.kind === 'link'));
  assert.ok(!results.some((result) => result.model === 'plugin' && result.kind !== 'link'));
});
