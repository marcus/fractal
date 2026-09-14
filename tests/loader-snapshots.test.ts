import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseModelWithOrigins } from '../src/lib/adapters/likec4';
import {
  catalogResolver,
  clearModelCache,
  listProjects,
  loadModel,
  snapshotOf,
  validateCatalog
} from '../src/lib/server/models';

const FIXTURES = 'tests/fixtures/linked-projects';
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));

/**
 * A catalog with a healthy host, a healthy plugin, an entry whose directory is absent, and a copy
 * of the plugin (still calling itself `plugin` in its companion) whose `model.c4` is unparseable.
 * The last entry is deliberately both an ID mismatch and an uncompilable model: listing must not
 * compile it, so it is reported by its companion ID alone.
 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fractal-loader-'));
  const models = join(root, 'models');
  await mkdir(models);
  await cp(join(FIXTURES, 'host'), join(models, 'host'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'plugin'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'broken'), { recursive: true });
  await writeFile(join(models, 'broken', 'model.c4'), 'this is not a model\n');
  const catalog = join(root, 'catalog.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'host', directory: join(models, 'host') },
        { id: 'plugin', directory: join(models, 'plugin') },
        { id: 'missing', directory: join(root, 'missing') },
        { id: 'broken', directory: join(models, 'broken') }
      ]
    })
  );
  return {
    root,
    models,
    catalog,
    options: { catalog, env: {}, home: join(root, 'home'), cwd: root }
  };
}

test('the adapter records explicit and fallback origins by metadata, not spelling', async () => {
  for (const name of ['host', 'plugin']) {
    const { model, origins } = await parseModelWithOrigins(
      await readFile(join(FIXTURES, name, 'model.c4'), 'utf8'),
      await json(join(FIXTURES, name, 'fractal.json'))
    );
    assert.equal(model.id, name);
    assert.deepEqual(origins, await json(join(FIXTURES, name, 'identity-origins.expected.json')));
    assert.equal(model.elements.find((element) => element.id === 'core')?.sourceId, 'core');
    assert.equal(
      model.elements.find((element) => element.id === 'core.fallback')?.sourceId,
      'core.fallback'
    );
  }
});

test('listProjects reports unhealthy entries without compiling any model', async () => {
  const { root, catalog, options } = await fixture();
  clearModelCache();
  try {
    const projects = await listProjects(options);
    assert.deepEqual(projects.map((project) => project.id).sort(), [
      'broken',
      'host',
      'missing',
      'plugin'
    ]);
    const byId = new Map(projects.map((project) => [project.id, project]));
    assert.equal(byId.get('host')?.title, 'Harbor host');
    assert.equal(byId.get('host')?.diagnostic, undefined);
    assert.equal(byId.get('plugin')?.title, 'Beacon plugin');
    assert.equal(byId.get('plugin')?.diagnostic, undefined);
    assert.equal(byId.get('missing')?.title, 'missing');
    assert.match(byId.get('missing')?.diagnostic ?? '', /Model directory missing:/);
    assert.equal(byId.get('broken')?.title, 'broken');
    assert.match(
      byId.get('broken')?.diagnostic ?? '',
      new RegExp(`Catalog ${catalog} project broken.*does not match companion model ID plugin`)
    );
    const ordered = [...projects].sort(
      (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
    );
    assert.deepEqual(
      projects.map((project) => project.id),
      ordered.map((project) => project.id),
      'the lightweight list keeps the established sort order'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateCatalog reports both failures instead of throwing', async () => {
  const { root, options } = await fixture();
  try {
    const validation = await validateCatalog(options);
    assert.equal(validation.projects.length, 4);
    const errors = new Map(
      validation.projects
        .filter((project) => project.error)
        .map((project) => [project.id, project.error])
    );
    assert.deepEqual([...errors.keys()].sort(), ['broken', 'missing']);
    assert.match(errors.get('missing') ?? '', /Model directory missing:/);
    assert.match(errors.get('broken') ?? '', /does not match companion model ID plugin/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loadModel folds links.json into the revision and drops it honestly', async () => {
  const { root, models, options } = await fixture();
  clearModelCache();
  try {
    const first = await loadModel('host', options);
    assert.equal(first.model.id, 'host');
    assert.equal(first.links?.links.length, 2);
    const firstRevision = first.revision;

    const links = await json(join(models, 'host', 'links.json'));
    links.links[0].title = 'Beacon architecture (revised)';
    await writeFile(join(models, 'host', 'links.json'), JSON.stringify(links, null, 2));
    const second = await loadModel('host', options);
    assert.notEqual(second.revision, firstRevision, 'a links.json edit changes the revision');
    assert.equal(second.links?.links[0].title, 'Beacon architecture (revised)');

    await rm(join(models, 'host', 'links.json'));
    const third = await loadModel('host', options);
    assert.equal(third.links, null);
    assert.notEqual(third.revision, second.revision, 'removing links.json changes the revision');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('snapshotOf carries parsed links and identity origins', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  try {
    const loaded = await loadModel('host', options);
    const snapshot = snapshotOf(loaded);
    assert.equal(snapshot.id, 'host');
    assert.equal(snapshot.model, loaded.model);
    assert.equal(snapshot.revision, loaded.revision);
    assert.deepEqual(snapshot.links, await json(join(FIXTURES, 'host', 'links.json')));
    assert.deepEqual(
      snapshot.origins,
      await json(join(FIXTURES, 'host', 'identity-origins.expected.json'))
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('catalogResolver maps resolved, unavailable and invalid without throwing', async () => {
  const { root, options } = await fixture();
  clearModelCache();
  try {
    const resolver = catalogResolver(options);

    const resolved = await resolver.resolve('plugin');
    assert.equal(resolved.status, 'resolved');
    if (resolved.status !== 'resolved') throw new Error('unreachable');
    assert.equal(resolved.snapshot.id, 'plugin');
    assert.equal(resolved.snapshot.origins.elements['core.fallback'], 'fallback');
    assert.equal(resolved.snapshot.origins.elements.core, 'explicit');

    for (const id of ['missing', 'unknown', 'Not-A-Slug']) {
      const outcome = await resolver.resolve(id);
      assert.equal(outcome.status, 'unavailable', `${id} must be unavailable`);
      if (outcome.status !== 'unavailable') throw new Error('unreachable');
      assert.equal(outcome.code, 'model_unavailable');
    }

    const invalid = await resolver.resolve('broken');
    assert.equal(invalid.status, 'invalid');
    if (invalid.status !== 'invalid') throw new Error('unreachable');
    assert.equal(invalid.code, 'model_invalid');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a bad links.json makes the directory invalid and reports unsupported versions', async () => {
  const { root, models, options } = await fixture();
  clearModelCache();
  try {
    await writeFile(join(models, 'host', 'links.json'), '{ not json');
    await assert.rejects(loadModel('host', options));
    const invalid = await catalogResolver(options).resolve('host');
    assert.equal(invalid.status, 'invalid');
    if (invalid.status !== 'invalid') throw new Error('unreachable');
    assert.equal(invalid.code, 'model_invalid');

    await writeFile(join(models, 'host', 'links.json'), JSON.stringify({ version: 2, links: [] }));
    const unsupported = await catalogResolver(options).resolve('host');
    assert.equal(unsupported.status, 'invalid');
    if (unsupported.status !== 'invalid') throw new Error('unreachable');
    assert.equal(unsupported.code, 'unsupported_version');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
