import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CompositionContractError } from '../src/lib/composition/parse';
import {
  clearCompositionCache,
  composeFromSelector,
  compositionCacheStats,
  inspectInComposition,
  linksFor,
  revisionConflict,
  validateLinked
} from '../src/lib/server/composition';
import { clearModelCache } from '../src/lib/server/models';

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
    assert.equal(compositionCacheStats().size, 0, 'links discovery never composes');

    const plugin = await linksFor('plugin', options);
    assert.deepEqual(plugin.resolution, [{ model: 'host', status: 'resolved' }]);

    await assert.rejects(linksFor('unknown', options), /Unknown model: unknown/);
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

test('a revision mismatch surfaces as a revision_changed conflict', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  clearCompositionCache();
  try {
    const { revisions } = await composeFromSelector('host', { composition: 'plugins' }, options);
    assert.equal(revisionConflict(revisions, revisions), undefined);
    const conflict = revisionConflict(revisions, { host: 'stale', unknown: 'ignored' });
    assert.equal(conflict?.code, 'revision_changed');
    assert.equal(conflict?.model, 'host');
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
