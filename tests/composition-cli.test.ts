import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { layout } from '../src/lib/core/layout';
import { loadModel } from '../src/lib/server/models';

const FIXTURES = 'tests/fixtures/linked-projects';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fractal-composition-cli-'));
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
  const options = { catalog, env: {}, home: join(root, 'home'), cwd: root };
  const run = (args: string[]) => {
    const result = spawnSync(resolve('bin/fractal'), args, {
      encoding: 'utf8',
      env: { ...process.env, FRACTAL_CATALOG: catalog }
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  return { root, catalog, options, run, models };
}

test('links --json reports authored links and resolution status', async () => {
  const { root, run } = await fixture();
  try {
    const { status, stdout } = run(['links', '--model', 'host', '--json']);
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.model, 'host');
    assert.deepEqual(
      result.resolution.map((entry: { model: string; status: string }) => ({
        model: entry.model,
        status: entry.status
      })),
      [
        { model: 'missing-plugin', status: 'unavailable' },
        { model: 'plugin', status: 'resolved' }
      ]
    );
    assert.match(result.resolution[0].message, /Model directory missing:/);
    assert.equal(result.links.links[0].target.model, 'plugin');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validate --linked exits 1 with diagnostics and 0 without --linked', async () => {
  const { root, run } = await fixture();
  try {
    const linked = run(['validate', '--model', 'host', '--linked']);
    assert.equal(linked.status, 1);
    const diagnostics = JSON.parse(linked.stdout);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, 'model_unavailable');

    const json = JSON.parse(run(['validate', '--model', 'host', '--linked', '--json']).stdout);
    assert.equal(json.valid, false);

    const plain = run(['validate', '--model', 'host']);
    assert.equal(plain.status, 0);
    assert.equal(JSON.parse(plain.stdout).valid, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('layout --composition prints a composed diagram and project omits local geometry', async () => {
  const { root, run } = await fixture();
  try {
    const laid = run(['layout', '--model', 'host', '--composition', 'plugins']);
    assert.equal(laid.status, 0);
    const composed = JSON.parse(laid.stdout);
    assert.deepEqual(
      composed.projects.map((project: { model: string; revision: string }) => project.model),
      ['host', 'plugin']
    );
    assert.ok(composed.bridges.length >= 2);
    assert.deepEqual(
      composed.stubs.map((stub: { state: string }) => stub.state),
      ['not_loaded']
    );
    assert.ok(composed.projects[0].diagram.nodes.length > 0);

    const reduced = run(['project', '--model', 'host', '--composition', 'plugins']);
    assert.equal(reduced.status, 0);
    const summary = JSON.parse(reduced.stdout);
    assert.equal('diagram' in summary.projects[0], false);
    assert.equal('frame' in summary.projects[0], true);
    assert.equal(summary.bridges.length, composed.bridges.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('layout without composition flags is unchanged and matches the core layout', async () => {
  const { root, run, options } = await fixture();
  try {
    const { status, stdout } = run(['layout', '--model', 'host']);
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout);
    assert.equal('projects' in parsed, false);
    assert.equal('bridges' in parsed, false);

    const loaded = await loadModel('host', options);
    const scene = loaded.model.scenes[0];
    const expected = JSON.parse(
      JSON.stringify(
        await layout(loaded.model, {
          expanded: scene.expanded,
          proposed: scene.proposed,
          lens: scene.lens
        })
      )
    );
    assert.deepEqual(parsed, expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('search in a composition qualifies results and lists unopened links as metadata', async () => {
  const { root, run } = await fixture();
  try {
    const { status, stdout } = run(['search', '--model', 'host', '--composition', 'plugins']);
    assert.equal(status, 0);
    const results = JSON.parse(stdout);
    assert.ok(results.some((entry: { model: string; id: string }) => entry.model === 'plugin'));
    const links = results.filter((entry: { source: string }) => entry.source === 'link');
    assert.deepEqual(links, [
      {
        model: 'missing-plugin',
        source: 'link',
        type: 'link',
        id: 'unavailable',
        title: 'Unregistered plugin',
        description: 'host → missing-plugin',
        owner: 'host',
        target: { model: 'missing-plugin' }
      }
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
