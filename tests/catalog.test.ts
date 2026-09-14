import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCatalog, searchProjects } from '../src/lib/core/catalog';
import {
  listModels,
  listProjects,
  loadModel,
  resolveCatalog,
  validateCatalog
} from '../src/lib/server/models';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fractal-catalog-'));
  const models = join(root, 'models');
  await mkdir(models);
  await cp('examples/delivery', join(models, 'delivery'), { recursive: true });
  await cp('examples/observatory', join(models, 'observatory'), { recursive: true });
  const catalog = join(root, 'catalog.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'delivery', directory: join(models, 'delivery') },
        { id: 'observatory', directory: join(models, 'observatory') }
      ]
    })
  );
  return { root, models, catalog };
}

test('catalog schema rejects malformed entries and duplicates without partial results', () => {
  assert.throws(() => parseCatalog({ version: 2, projects: [] }), /version must be 1/);
  assert.throws(
    () => parseCatalog({ version: 1, projects: [{ id: 'Bad ID', directory: '/tmp/model' }] }),
    /lowercase slug/
  );
  assert.throws(
    () =>
      parseCatalog({
        version: 1,
        projects: [
          { id: 'same', directory: '/tmp/one' },
          { id: 'same', directory: '/tmp/two' }
        ]
      }),
    /duplicate ID/
  );
  assert.throws(
    () => parseCatalog({ version: 1, projects: [{ id: 'relative', directory: 'models/one' }] }),
    /clean absolute path/
  );
  for (const directory of ['/tmp/model ', '/tmp/model\0extra'])
    assert.throws(
      () => parseCatalog({ version: 1, projects: [{ id: 'unclean', directory }] }),
      /clean absolute path/
    );
});

test('explicit catalogs load fresh models, expose summaries, and enforce durable identity', async () => {
  const { root, models, catalog } = await fixture();
  try {
    const options = { catalog, env: {}, home: join(root, 'home'), cwd: root };
    const summaries = await listModels(options);
    assert.deepEqual(
      summaries.map((project) => project.id),
      ['delivery', 'observatory']
    );
    assert.equal((await loadModel('delivery', options)).model.title, 'Fictional Delivery Service');
    assert.deepEqual(
      (await listProjects(options)).map(({ id, directory }) => ({ id, directory })),
      [
        { id: 'delivery', directory: join(models, 'delivery') },
        { id: 'observatory', directory: join(models, 'observatory') }
      ]
    );

    const moved = join(root, 'moved-observatory');
    await rename(join(models, 'observatory'), moved);
    await writeFile(
      catalog,
      JSON.stringify({
        version: 1,
        projects: [
          { id: 'delivery', directory: join(models, 'delivery') },
          { id: 'observatory', directory: moved }
        ]
      })
    );
    assert.equal((await loadModel('observatory', options)).model.id, 'observatory');

    // Listing is now lightweight: a bad entry is reported, never thrown, and healthy entries load.
    await writeFile(
      catalog,
      JSON.stringify({
        version: 1,
        projects: [
          { id: 'delivery', directory: join(models, 'delivery') },
          { id: 'missing', directory: join(root, 'missing') }
        ]
      })
    );
    assert.deepEqual(
      (await listModels(options)).map(({ id, title, diagnostic }) => ({
        id,
        title,
        hasDiagnostic: Boolean(diagnostic)
      })),
      [
        { id: 'delivery', title: 'Fictional Delivery Service', hasDiagnostic: false },
        { id: 'missing', title: 'missing', hasDiagnostic: true }
      ]
    );
    await assert.rejects(loadModel('missing', options), /Model directory missing:/);
    assert.equal((await loadModel('delivery', options)).model.id, 'delivery');
    assert.deepEqual((await validateCatalog(options)).projects, [
      { id: 'delivery', directory: join(models, 'delivery') },
      {
        id: 'missing',
        directory: join(root, 'missing'),
        error: `Model directory missing: ${join(root, 'missing')}`
      }
    ]);

    await writeFile(
      catalog,
      JSON.stringify({
        version: 1,
        projects: [{ id: 'wrong-id', directory: join(root, 'models/delivery') }]
      })
    );
    await assert.rejects(
      loadModel('wrong-id', options),
      new RegExp(`Catalog ${catalog} project wrong-id.*does not match companion model ID delivery`)
    );
    const [wrong] = await listModels(options);
    assert.equal(wrong.title, 'wrong-id');
    assert.match(wrong.diagnostic ?? '', /does not match companion model ID delivery/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('catalog selection honors precedence, expands home, and fails explicit missing paths', async () => {
  const { root, models, catalog } = await fixture();
  try {
    const home = join(root, 'home');
    await mkdir(join(home, '.config/fractal'), { recursive: true });
    await cp(catalog, join(home, '.config/fractal/catalog.json'));
    assert.equal((await resolveCatalog({ env: {}, home, cwd: root })).kind, 'catalog');
    assert.equal(
      (await resolveCatalog({ catalog, env: { FRACTAL_CATALOG: '/missing' }, home, cwd: root }))
        .path,
      catalog
    );
    assert.equal(
      (await resolveCatalog({ env: { FRACTAL_MODELS_DIR: models }, home, cwd: root })).kind,
      'models-directory'
    );
    assert.equal(
      (
        await resolveCatalog({
          env: { FRACTAL_CATALOG: '', FRACTAL_MODELS_DIR: models },
          home,
          cwd: root
        })
      ).kind,
      'models-directory'
    );
    await assert.rejects(
      resolveCatalog({ catalog: '~/missing.json', env: {}, home, cwd: root }),
      new RegExp(join(home, 'missing.json'))
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('duplicate catalog IDs are fatal for the whole catalog', async () => {
  const { root, models, catalog } = await fixture();
  try {
    await writeFile(
      catalog,
      JSON.stringify({
        version: 1,
        projects: [
          { id: 'delivery', directory: join(models, 'delivery') },
          { id: 'delivery', directory: join(models, 'observatory') }
        ]
      })
    );
    const options = { catalog, env: {}, home: join(root, 'home'), cwd: root };
    await assert.rejects(resolveCatalog(options), /duplicate/);
    await assert.rejects(listModels(options), /duplicate/);
    await assert.rejects(loadModel('delivery', options), /duplicate/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('one malformed unrelated model does not block healthy entries', async () => {
  const { root, models, catalog } = await fixture();
  try {
    await writeFile(join(models, 'observatory', 'model.c4'), 'this is not a LikeC4 model');
    const options = { catalog, env: {}, home: join(root, 'home'), cwd: root };
    // The picker still lists everything: listing reads companions only, so the broken
    // source is listed without a diagnostic and reported when the model is opened.
    const listed = await listModels(options);
    assert.equal(listed.length, 2);
    assert.equal(
      listed.find((project) => project.id === 'observatory')?.diagnostic,
      undefined,
      'listing reads companions only, so a broken source is not a listing failure'
    );
    assert.equal((await loadModel('delivery', options)).model.id, 'delivery');
    await assert.rejects(loadModel('observatory', options), /Invalid model/);
    assert.equal((await loadModel('delivery', options)).model.id, 'delivery');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project search covers identity, title, and description', () => {
  const projects = [
    {
      id: 'delivery',
      title: 'Fictional Delivery Service',
      description: 'Fictional order fulfillment'
    },
    { id: 'observatory', title: 'Observatory', description: 'Useful signals' }
  ];
  assert.deepEqual(searchProjects(projects, 'delivery'), [projects[0]]);
  assert.deepEqual(searchProjects(projects, 'OBS'), [projects[1]]);
  assert.deepEqual(searchProjects(projects, ''), projects);
});
