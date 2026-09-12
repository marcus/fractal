import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearModelCache,
  listProjects,
  loadDirectory,
  modelCacheStats
} from '../src/lib/server/models';
import {
  clearRenderCache,
  renderDiagram,
  renderCacheStats,
  renderKey
} from '../src/lib/server/render';
import type { Model, ViewState } from '../src/lib/core/types';

async function directory(name = 'delivery') {
  const root = await mkdtemp(join(tmpdir(), 'fractal-cache-'));
  await cp(`examples/${name}`, join(root, name), { recursive: true });
  return { root, path: join(root, name) };
}

test('a parsed model is reused while its files are untouched', async () => {
  const { root, path } = await directory();
  clearModelCache();
  try {
    const first = await loadDirectory(path);
    assert.deepEqual(modelCacheStats(), { hits: 0, misses: 1, size: 1 });
    const second = await loadDirectory(path);
    assert.equal(modelCacheStats().misses, 1, 'a warm call must not parse again');
    assert.equal(modelCacheStats().hits, 1);
    assert.equal(second, first, 'the same parse is handed back');
    assert.equal(second.revision, first.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('editing any model file parses again and changes the revision', async () => {
  const { root, path } = await directory();
  clearModelCache();
  try {
    const before = await loadDirectory(path);
    await appendFile(join(path, 'model.c4'), '\n// an authored note\n');
    const afterSource = await loadDirectory(path);
    assert.equal(modelCacheStats().misses, 2, 'an edited model.c4 must be parsed again');
    assert.notEqual(afterSource.revision, before.revision);

    const companion = JSON.parse(await readFile(join(path, 'fractal.json'), 'utf8'));
    companion.description = `${companion.description} (revised)`;
    await writeFile(join(path, 'fractal.json'), JSON.stringify(companion, null, 2));
    const afterCompanion = await loadDirectory(path);
    assert.equal(modelCacheStats().misses, 3, 'an edited fractal.json must be parsed again');
    assert.notEqual(afterCompanion.revision, afterSource.revision);
    assert.match(afterCompanion.model.description, /revised/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('removing or restoring sequences.json parses again', async () => {
  const { root, path } = await directory();
  clearModelCache();
  try {
    const withSequences = await loadDirectory(path);
    assert.ok(withSequences.sequences.length > 0);
    const source = await readFile(join(path, 'sequences.json'), 'utf8');

    await rm(join(path, 'sequences.json'));
    const without = await loadDirectory(path);
    assert.equal(modelCacheStats().misses, 2, 'a removed sequences.json must be parsed again');
    assert.deepEqual(without.sequences, []);
    assert.equal(without.sequenceSource, null);
    assert.notEqual(without.revision, withSequences.revision);

    await writeFile(join(path, 'sequences.json'), source);
    const restored = await loadDirectory(path);
    assert.equal(modelCacheStats().misses, 3, 'a restored sequences.json must be parsed again');
    assert.equal(restored.revision, withSequences.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the parsed-model cache is keyed per directory', async () => {
  const { root, path } = await directory();
  clearModelCache();
  try {
    const copy = join(root, 'second-copy');
    await cp(path, copy, { recursive: true });
    const first = await loadDirectory(path);
    const second = await loadDirectory(copy);
    assert.equal(modelCacheStats().misses, 2, 'a second directory is its own entry');
    assert.equal(modelCacheStats().size, 2);
    assert.notEqual(second, first);
    assert.equal(second.revision, first.revision, 'identical files still hash the same');
    await loadDirectory(path);
    assert.equal(modelCacheStats().hits, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an invalid model keeps failing, from loadDirectory and from the project list', async () => {
  const { root, path } = await directory();
  const previous = process.env.FRACTAL_MODELS_DIR;
  clearModelCache();
  try {
    await writeFile(join(path, 'model.c4'), 'this is not a model\n');
    for (const attempt of [1, 2, 3]) {
      await assert.rejects(loadDirectory(path), `attempt ${attempt} must fail`);
    }
    assert.equal(modelCacheStats().hits, 0, 'a failed parse is never remembered');
    process.env.FRACTAL_MODELS_DIR = root;
    await assert.rejects(listProjects());
    await assert.rejects(listProjects());
  } finally {
    if (previous === undefined) delete process.env.FRACTAL_MODELS_DIR;
    else process.env.FRACTAL_MODELS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

const STATE: ViewState = { expanded: [], proposed: false, lens: 'structure' };

/** A model small enough to lay out many times, with one container a view can open. */
function tinyModel(count: number): Model {
  const element = (id: string, parent: string | null) => ({
    id,
    sourceId: id,
    parent,
    title: id,
    kind: 'component',
    description: '',
    technology: '',
    status: 'current' as const,
    color: '',
    evidence: []
  });
  return {
    version: 1,
    id: 'tiny',
    title: 'Tiny',
    description: '',
    provenance: 'test fixture',
    elements: [
      element('root', null),
      ...Array.from({ length: count }, (_, index) => element(`leaf-${index}`, 'root'))
    ],
    relationships: [],
    boundaries: [],
    scenes: [{ id: 'overview', title: 'Overview', description: '', ...STATE }]
  };
}

test('an identical view is laid out once and returned as its own value', async () => {
  clearRenderCache();
  const loaded = { model: tinyModel(3), revision: 'rev-1' };
  const first = await renderDiagram(loaded, { ...STATE, expanded: ['root'] });
  const second = await renderDiagram(loaded, { ...STATE, expanded: ['root'] });
  assert.deepEqual(second, first, 'a hit is the same diagram');
  assert.notEqual(second, first, 'a hit is a private copy, safe to mutate');
  assert.notEqual(second.nodes, first.nodes);
  assert.deepEqual(renderCacheStats(), { hits: 1, misses: 1, size: 1 });

  second.nodes[0].x = -9999;
  const third = await renderDiagram(loaded, { ...STATE, expanded: ['root'] });
  assert.deepEqual(third, first, 'a mutated result never reaches the next reader');
});

test('the view-state key ignores the order of expanded and nothing else', async () => {
  clearRenderCache();
  const loaded = { model: tinyModel(2), revision: 'rev-1' };
  assert.equal(
    renderKey('rev-1', { ...STATE, expanded: ['b', 'a'] }),
    renderKey('rev-1', { ...STATE, expanded: ['a', 'b'] }),
    'expanded is a set, not a sequence'
  );
  assert.notEqual(renderKey('rev-1', STATE), renderKey('rev-2', STATE));
  for (const other of [
    { ...STATE, proposed: true },
    { ...STATE, lens: 'trust' as const },
    { ...STATE, theme: 'midnight' as const },
    { ...STATE, scope: 'root' },
    { ...STATE, expanded: ['root'] },
    { ...STATE, layout: 'elk-layered-down' as const }
  ])
    assert.notEqual(renderKey('rev-1', STATE), renderKey('rev-1', other));

  await renderDiagram(loaded, { ...STATE, expanded: ['root', 'leaf-0'] });
  const reordered = await renderDiagram(loaded, { ...STATE, expanded: ['leaf-0', 'root'] });
  assert.equal(renderCacheStats().hits, 1, 'the same set in another order is the same view');
  assert.deepEqual(
    reordered.state.expanded,
    ['leaf-0', 'root'],
    'the echoed state is the one that was asked for'
  );
});

test('a different view state or a changed model is laid out again', async () => {
  clearRenderCache();
  const model = tinyModel(2);
  await renderDiagram({ model, revision: 'rev-1' }, STATE);
  await renderDiagram({ model, revision: 'rev-1' }, { ...STATE, expanded: ['root'] });
  assert.equal(renderCacheStats().misses, 2, 'a different view state misses');
  await renderDiagram({ model, revision: 'rev-2' }, STATE);
  assert.equal(renderCacheStats().misses, 3, 'a model edited on disk misses');
  assert.equal(renderCacheStats().hits, 0);
});

test('the engine is part of a rendered view, so two flows never share one entry', async () => {
  clearRenderCache();
  const loaded = { model: tinyModel(3), revision: 'rev-1' };
  const across = await renderDiagram(loaded, { ...STATE, expanded: ['root'] });
  const down = await renderDiagram(loaded, {
    ...STATE,
    expanded: ['root'],
    layout: 'elk-layered-down'
  });
  assert.equal(renderCacheStats().misses, 2, 'the second engine is laid out, not served');
  assert.notDeepEqual(down.nodes, across.nodes, 'and it produced its own geometry');
  assert.equal(down.state.layout, 'elk-layered-down');
  await renderDiagram(loaded, { ...STATE, expanded: ['root'], layout: 'elk-layered-down' });
  await renderDiagram(loaded, { ...STATE, expanded: ['root'] });
  assert.deepEqual(renderCacheStats(), { hits: 2, misses: 2, size: 2 });
});

test('the layout cache evicts the least recently used view', async () => {
  clearRenderCache();
  const loaded = { model: tinyModel(65), revision: 'rev-1' };
  // Opening a leaf inside a collapsed root shows the same thing every time: 65 distinct view
  // states over one small drawing, which is what the cache is keyed on.
  const view = (index: number) => ({ ...STATE, expanded: [`leaf-${index}`] });
  const first = await renderDiagram(loaded, view(0));
  for (let index = 1; index <= 64; index += 1) await renderDiagram(loaded, view(index));
  assert.equal(renderCacheStats().size, 64, 'the cache stays bounded');
  assert.equal(renderCacheStats().hits, 0);

  await renderDiagram(loaded, view(64));
  assert.equal(renderCacheStats().hits, 1, 'the newest view is still there');
  const again = await renderDiagram(loaded, view(0));
  assert.equal(renderCacheStats().hits, 1, 'the oldest view was evicted');
  assert.deepEqual(again, first, 'and laying it out again gives the same geometry');
});
