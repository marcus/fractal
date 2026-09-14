import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { encodeCompositionState } from '../src/lib/composition/codec';
import { DEFAULT_COMPOSITION_LIMITS } from '../src/lib/composition/limits';
import { CompositionContractError, parseCompositionState } from '../src/lib/composition/parse';
import {
  BudgetExceededError,
  clearCompositionCache,
  composeFromSelector,
  compositionCacheStats,
  inspectInComposition,
  linksFor,
  reloadComposition,
  resolveCompositionStateInput,
  RevisionConflictError,
  searchInComposition,
  validateLinked
} from '../src/lib/server/composition';
import { clearModelCache, reloadDirectory, SourceChangingError } from '../src/lib/server/models';

const FIXTURES = 'tests/fixtures/linked-projects';

/** A catalog with a healthy host, a healthy plugin and a deliberately missing entry. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fractal-composition-'));
  const models = join(root, 'models');
  await mkdir(models);
  await cp(join(FIXTURES, 'host'), join(models, 'host'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'plugin'), { recursive: true });
  const catalog = join(root, 'catalog.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'host', directory: join(models, 'host') },
        { id: 'plugin', directory: join(models, 'plugin') },
        { id: 'missing-plugin', directory: join(root, 'missing-plugin') }
      ]
    })
  );
  return { root, catalog, options: { catalog, env: {}, home: join(root, 'home'), cwd: root } };
}

test('linksFor reports each foreign model without composing anything', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    const result = await linksFor('host', options);
    assert.equal(result.model, 'host');
    assert.equal(result.links?.links.length, 2);
    assert.deepEqual(result.resolution, [
      {
        model: 'missing-plugin',
        status: 'unavailable',
        message: `Model directory missing: ${join(root, 'missing-plugin')}`
      },
      { model: 'plugin', status: 'resolved' }
    ]);
    assert.equal(compositionCacheStats().entries, 0, 'links discovery never composes');

    const plugin = await linksFor('plugin', options);
    assert.deepEqual(plugin.resolution, [{ model: 'host', status: 'resolved' }]);

    await assert.rejects(linksFor('unknown', options), /Unknown model: unknown/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('links reports catalog availability without compiling a malformed foreign model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-composition-links-'));
  const models = join(root, 'models');
  await mkdir(models);
  await cp(join(FIXTURES, 'host'), join(models, 'host'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'plugin'), { recursive: true });
  await writeFile(join(models, 'plugin', 'model.c4'), 'this is not a LikeC4 model');
  const catalog = join(root, 'catalog.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'host', directory: join(models, 'host') },
        { id: 'plugin', directory: join(models, 'plugin') },
        { id: 'missing-plugin', directory: join(root, 'missing-plugin') }
      ]
    })
  );
  const options = { catalog, env: {}, home: join(root, 'home'), cwd: root };
  clearModelCache();
  clearCompositionCache();
  try {
    const links = await linksFor('host', options);
    assert.deepEqual(links.resolution, [
      {
        model: 'missing-plugin',
        status: 'unavailable',
        message: `Model directory missing: ${join(root, 'missing-plugin')}`
      },
      { model: 'plugin', status: 'resolved' }
    ]);

    // Full validation is what loads the target and notices the broken source.
    const validation = await validateLinked('host', options);
    assert.equal(validation.valid, false);
    const invalid = validation.diagnostics.find((entry) => entry.code === 'model_invalid');
    assert.ok(invalid, 'validateLinked reports the malformed plugin');
    assert.equal(invalid.target?.model, 'plugin');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateLinked resolves the closure and reports only the unresolved claim', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    const result = await validateLinked('host', options);
    assert.equal(result.model, 'host');
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics.length, 1);
    const [diagnostic] = result.diagnostics;
    assert.equal(diagnostic.code, 'model_unavailable');
    assert.equal(diagnostic.ownerModel, 'host');
    assert.equal(diagnostic.linkId, 'unavailable');
    assert.equal(diagnostic.recovery, 'register');
    assert.deepEqual(diagnostic.target, { model: 'missing-plugin' });

    const local = await validateLinked('host', { ...options, catalog: options.catalog });
    assert.equal(
      local.diagnostics.some((entry) => entry.code === 'endpoint_missing'),
      false
    );
    assert.equal(
      local.diagnostics.some((entry) => entry.code === 'identity_not_explicit'),
      false
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('composeFromSelector composes an authored composition and reuses the cache', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    const first = await composeFromSelector('host', { composition: 'plugins' }, options);
    assert.deepEqual(
      first.composed.projects.map((project) => project.model),
      ['host', 'plugin']
    );
    assert.ok(first.composed.bridges.some((bridge) => bridge.owner === 'host'));
    assert.ok(first.composed.bridges.some((bridge) => bridge.owner === 'plugin'));
    assert.equal(first.composed.stubs.length, 1);
    assert.equal(first.composed.stubs[0].state, 'not_loaded');
    assert.deepEqual(Object.keys(first.revisions).sort(), ['host', 'plugin']);

    const afterFirst = compositionCacheStats();
    const second = await composeFromSelector('host', { composition: 'plugins' }, options);
    assert.deepEqual(second, first);
    const afterSecond = compositionCacheStats();
    assert.equal(afterSecond.hits, afterFirst.hits + 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('composition and an explicit state are mutually exclusive', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    await assert.rejects(
      composeFromSelector('host', { composition: 'plugins', state: { version: 1 } }, options),
      /mutually exclusive/
    );
    await assert.rejects(
      composeFromSelector('host', { composition: 'absent' }, options),
      /Unknown composition: absent/
    );
    await assert.rejects(composeFromSelector('unknown', {}, options), /Unknown model: unknown/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an oversized explicit state is a budget_exceeded contract error', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    const state = {
      version: 1,
      root: 'host',
      composition: 'é'.repeat(40_000),
      projects: [
        { model: 'host', mode: 'open', view: { expanded: [], proposed: false, lens: 'structure' } }
      ],
      theme: 'grove',
      layout: 'elk-layered'
    };
    await assert.rejects(
      composeFromSelector('host', { state }, options),
      (error: unknown) =>
        error instanceof CompositionContractError && error.code === 'budget_exceeded'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inspectInComposition inspects a participating project', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    const inspection = await inspectInComposition(
      'host',
      { composition: 'plugins' },
      { kind: 'project', model: 'plugin' },
      options
    );
    if (inspection.kind !== 'project') throw new Error('expected a project inspection');
    assert.equal(inspection.model, 'plugin');
    assert.equal(inspection.counts.elements, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a caller revision vector is enforced with expected and actual revisions', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    const first = await composeFromSelector('host', { composition: 'plugins' }, options);
    const same = await composeFromSelector(
      'host',
      { composition: 'plugins' },
      { ...options, revisions: first.revisions }
    );
    assert.deepEqual(same.revisions, first.revisions);

    // Models the loader never resolved cannot conflict.
    const extra = await composeFromSelector(
      'host',
      { composition: 'plugins' },
      { ...options, revisions: { ...first.revisions, ghost: 'whatever' } }
    );
    assert.deepEqual(extra.revisions, first.revisions);

    const stale = { ...first.revisions, plugin: 'stale' };
    await assert.rejects(
      composeFromSelector('host', { composition: 'plugins' }, { ...options, revisions: stale }),
      (error: unknown) => {
        assert.ok(error instanceof RevisionConflictError);
        assert.equal(error.code, 'revision_changed');
        assert.equal(error.model, 'plugin');
        assert.equal(error.expected, 'stale');
        assert.equal(error.actual, first.revisions.plugin);
        assert.equal(error.recovery, 'reload');
        return true;
      }
    );

    await assert.rejects(
      composeFromSelector(
        'host',
        { composition: 'plugins' },
        // Untyped callers (HTTP bodies) reach the runtime shape check through this cast.
        { ...options, revisions: ['x'] as unknown as Record<string, string> }
      ),
      /revisions must be an object/
    );
    await assert.rejects(
      composeFromSelector('host', { composition: 'plugins' }, { ...options, generation: 1.5 }),
      /generation must be a nonnegative integer/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('generations echo verbatim without joining the cache key', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    const plain = await composeFromSelector('host', { composition: 'plugins' }, options);
    assert.equal(plain.generation, undefined);

    const first = await composeFromSelector(
      'host',
      { composition: 'plugins' },
      { ...options, generation: 7 }
    );
    assert.equal(first.generation, 7);
    const { generation: _dropped, ...firstRest } = first;
    const { generation: _absent, ...plainRest } = plain;
    assert.deepEqual(firstRest, plainRest);

    const before = compositionCacheStats();
    const second = await composeFromSelector(
      'host',
      { composition: 'plugins' },
      { ...options, generation: 8 }
    );
    assert.equal(second.generation, 8);
    assert.equal(compositionCacheStats().hits, before.hits + 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateLinked checks every owner against the resolved closure, not traversal order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-symmetric-'));
  const models = join(root, 'models');
  await mkdir(models);
  await cp(join(FIXTURES, 'host'), join(models, 'host'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'plugin'), { recursive: true });
  // Break the endpoint in both directions and drop the unrelated unavailable link so the
  // assertion names exactly the two reciprocal failures.
  for (const model of ['host', 'plugin']) {
    const path = join(models, model, 'links.json');
    const links = JSON.parse(await readFile(path, 'utf8'));
    links.connections[0].target.element = 'ghost';
    if (model === 'host')
      links.links = links.links.filter((link: { id: string }) => link.id !== 'unavailable');
    await writeFile(path, JSON.stringify(links));
  }
  const catalog = join(root, 'catalog.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'host', directory: join(models, 'host') },
        { id: 'plugin', directory: join(models, 'plugin') }
      ]
    })
  );
  const options = { catalog, env: {}, home: join(root, 'home'), cwd: root };
  clearModelCache();
  clearCompositionCache();
  try {
    const result = await validateLinked('host', options);
    assert.equal(result.valid, false);
    const broken = result.diagnostics.filter((entry) => entry.code === 'endpoint_missing');
    assert.equal(broken.length, 2);
    assert.deepEqual(
      broken.map((entry) => entry.ownerModel),
      ['host', 'plugin']
    );
    for (const entry of broken) {
      assert.equal(entry.connectionId, 'call');
      assert.equal(entry.recovery, 'repair');
      assert.equal(entry.target?.element, 'ghost');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a malformed unrelated model does not block a healthy composition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-isolation-'));
  const models = join(root, 'models');
  await mkdir(models);
  await cp(join(FIXTURES, 'host'), join(models, 'host'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'plugin'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'broken'), { recursive: true });
  await writeFile(join(models, 'broken', 'model.c4'), 'this is not a LikeC4 model');
  await writeFile(
    join(models, 'broken', 'fractal.json'),
    JSON.stringify({
      version: 1,
      id: 'broken',
      title: 'Broken plugin',
      description: 'A malformed unrelated model.',
      provenance: 'test',
      boundaries: [],
      scenes: [
        {
          id: 'overview',
          title: 'Overview',
          description: 'Broken overview.',
          expanded: [],
          proposed: false,
          lens: 'structure'
        }
      ]
    })
  );
  const catalog = join(root, 'catalog.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'host', directory: join(models, 'host') },
        { id: 'plugin', directory: join(models, 'plugin') },
        { id: 'broken', directory: join(models, 'broken') }
      ]
    })
  );
  const options = { catalog, env: {}, home: join(root, 'home'), cwd: root };
  clearModelCache();
  clearCompositionCache();
  try {
    const result = await composeFromSelector('host', { composition: 'plugins' }, options);
    assert.deepEqual(
      result.composed.projects.map((project) => project.model),
      ['host', 'plugin']
    );
    assert.deepEqual(Object.keys(result.revisions).sort(), ['host', 'plugin']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('duplicate catalog IDs are fatal for the whole catalog', async () => {
  const { root, catalog, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    await writeFile(
      catalog,
      JSON.stringify({
        version: 1,
        projects: [
          { id: 'host', directory: join(root, 'models', 'host') },
          { id: 'host', directory: join(root, 'models', 'plugin') }
        ]
      })
    );
    await assert.rejects(linksFor('host', options), /duplicate/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a broken target UID is endpoint_missing with owner and recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-broken-uid-'));
  const models = join(root, 'models');
  await mkdir(models);
  await cp(join(FIXTURES, 'host'), join(models, 'host'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'plugin'), { recursive: true });
  const path = join(models, 'host', 'links.json');
  const links = JSON.parse(await readFile(path, 'utf8'));
  links.connections[0].target.element = 'ghost';
  await writeFile(path, JSON.stringify(links));
  const catalog = join(root, 'catalog.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'host', directory: join(models, 'host') },
        { id: 'plugin', directory: join(models, 'plugin') }
      ]
    })
  );
  const options = { catalog, env: {}, home: join(root, 'home'), cwd: root };
  clearModelCache();
  clearCompositionCache();
  try {
    const validation = await validateLinked('host', options);
    assert.equal(validation.valid, false);
    const broken = validation.diagnostics.find((entry) => entry.code === 'endpoint_missing');
    assert.ok(broken);
    assert.equal(broken.ownerModel, 'host');
    assert.equal(broken.connectionId, 'call');
    assert.deepEqual(broken.target, { model: 'plugin', element: 'ghost' });
    assert.equal(broken.recovery, 'repair');

    // The root still composes; the broken claim is a diagnostic, not a failure.
    const result = await composeFromSelector('host', { composition: 'plugins' }, options);
    assert.deepEqual(
      result.composed.projects.map((project) => project.model),
      ['host', 'plugin']
    );
    assert.ok(
      result.composed.diagnostics.some((entry) => entry.code === 'endpoint_missing'),
      'the broken claim stays inspectable in the composed result'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('admission limits refuse an over-limit composition whole', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    const before = compositionCacheStats();
    await assert.rejects(
      composeFromSelector(
        'host',
        { composition: 'plugins' },
        { ...options, limits: { ...DEFAULT_COMPOSITION_LIMITS, projects: 1 } }
      ),
      (error: unknown) => {
        assert.ok(error instanceof BudgetExceededError);
        assert.equal(error.code, 'budget_exceeded');
        assert.deepEqual(error.diagnostics[0].budget, {
          resource: 'projects',
          actual: 2,
          limit: 1
        });
        return true;
      }
    );
    assert.equal(
      compositionCacheStats().entries,
      before.entries,
      'refused results are never cached'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reload observes disk edits after a revision conflict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-reload-'));
  const models = join(root, 'models');
  await mkdir(models);
  await cp(join(FIXTURES, 'host'), join(models, 'host'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'plugin'), { recursive: true });
  const catalog = join(root, 'catalog.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'host', directory: join(models, 'host') },
        { id: 'plugin', directory: join(models, 'plugin') }
      ]
    })
  );
  const options = { catalog, env: {}, home: join(root, 'home'), cwd: root };
  clearModelCache();
  clearCompositionCache();
  try {
    const first = await composeFromSelector('host', { composition: 'plugins' }, options);
    const pluginSource = join(models, 'plugin', 'model.c4');
    await writeFile(pluginSource, `${await readFile(pluginSource, 'utf8')}\n`);

    await assert.rejects(
      composeFromSelector(
        'host',
        { composition: 'plugins' },
        { ...options, revisions: first.revisions }
      ),
      (error: unknown) => {
        assert.ok(error instanceof RevisionConflictError);
        assert.equal(error.model, 'plugin');
        assert.equal(error.expected, first.revisions.plugin);
        return true;
      }
    );

    const reloaded = await reloadComposition('host', { composition: 'plugins' }, options);
    assert.notEqual(reloaded.revisions.plugin, first.revisions.plugin);
    assert.equal(reloaded.revisions.host, first.revisions.host);
    const again = await composeFromSelector(
      'host',
      { composition: 'plugins' },
      { ...options, revisions: reloaded.revisions }
    );
    assert.deepEqual(again.revisions, reloaded.revisions);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reloadDirectory retries one stamp mismatch before reporting source_changing', async () => {
  const { root } = await fixture();
  const directory = join(root, 'models', 'host');
  try {
    const fresh = await reloadDirectory(directory);
    assert.ok(fresh.revision);

    // A stamp that flips once proves the retry; one that never settles proves the error.
    let stamps = 0;
    const retrying = await reloadDirectory(directory, {
      stamp: async () => {
        stamps += 1;
        return stamps <= 2 ? `stamp-${stamps}` : 'stamp-steady';
      },
      read: async () => fresh
    });
    assert.equal(retrying.revision, fresh.revision);
    assert.equal(stamps, 4, 'one failed read plus one verified read');

    let moving = 0;
    await assert.rejects(
      reloadDirectory(directory, {
        stamp: async () => `stamp-${(moving += 1)}`,
        read: async () => fresh
      }),
      (error: unknown) => {
        assert.ok(error instanceof SourceChangingError);
        assert.equal(error.code, 'source_changing');
        assert.equal(error.recovery, 'retry');
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('explicit state accepts an encoded v1. permalink value', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    const raw = JSON.parse(await readFile(join(FIXTURES, 'composition.json'), 'utf8'));
    const encoded = encodeCompositionState(parseCompositionState(raw));
    assert.ok(encoded.startsWith('v1.'));
    assert.deepEqual(resolveCompositionStateInput(encoded), parseCompositionState(raw));
    const result = await composeFromSelector('host', { state: encoded }, options);
    assert.deepEqual(
      result.composed.projects.map((project) => project.model),
      ['host', 'plugin']
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('searchInComposition answers through the core scorer with link metadata', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    const results = await searchInComposition('host', { composition: 'plugins' }, '', options);
    assert.ok(results.length > 0);
    for (const result of results) assert.ok(result.selection && result.reveal);
    assert.ok(
      results.some((result) => result.model === 'plugin' && result.kind !== 'link'),
      'participating models are searched'
    );
    const link = results.find((result) => result.kind === 'link');
    assert.ok(link, 'an unopened link is searchable metadata');
    assert.equal(link.owner, 'host');
    assert.deepEqual(link.target, { model: 'missing-plugin' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
