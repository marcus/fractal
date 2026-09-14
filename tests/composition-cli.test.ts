import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { encodeCompositionState } from '../src/lib/composition/codec';
import { parseCompositionState } from '../src/lib/composition/parse';
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

test('links reports catalog availability; validate --linked detects a malformed target', async () => {
  const { root, run, models } = await fixture();
  try {
    await writeFile(join(models, 'plugin', 'model.c4'), 'this is not a LikeC4 model');
    const links = JSON.parse(run(['links', '--model', 'host', '--json']).stdout);
    const plugin = links.resolution.find((entry: { model: string }) => entry.model === 'plugin');
    assert.equal(plugin.status, 'resolved', 'links does not compile the foreign model');

    const validated = run(['validate', '--model', 'host', '--linked', '--json']);
    assert.equal(validated.status, 1);
    const json = JSON.parse(validated.stdout);
    assert.equal(json.valid, false);
    assert.ok(
      json.diagnostics.some(
        (entry: { code: string; target?: { model?: string } }) =>
          entry.code === 'model_invalid' && entry.target?.model === 'plugin'
      ),
      'validate --linked compiles the target and reports it invalid'
    );
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

test('search in a composition uses the core scorer with link metadata', async () => {
  const { root, run } = await fixture();
  try {
    const { status, stdout } = run(['search', '--model', 'host', '--composition', 'plugins']);
    assert.equal(status, 0);
    const results = JSON.parse(stdout);
    assert.ok(
      results.some(
        (entry: { model: string; kind: string }) =>
          entry.model === 'plugin' && entry.kind !== 'link'
      ),
      'participating models are searched'
    );
    for (const entry of results) {
      assert.ok(entry.selection, 'every hit carries its qualified selection');
      assert.ok(entry.reveal, 'every hit carries its reveal hint');
    }
    const links = results.filter((entry: { kind: string }) => entry.kind === 'link');
    assert.deepEqual(links, [
      {
        model: 'host',
        kind: 'link',
        id: 'unavailable',
        title: 'Unregistered plugin',
        description: 'host → missing-plugin',
        score: links[0].score,
        selection: { kind: 'project', model: 'host' },
        reveal: { model: 'host', expanded: links[0].reveal.expanded },
        owner: 'host',
        linkId: 'unavailable',
        target: { model: 'missing-plugin' }
      }
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('layout --composition-state accepts an encoded v1. permalink value', async () => {
  const { root, run } = await fixture();
  try {
    const encoded = encodeCompositionState(
      parseCompositionState(JSON.parse(await readFile(join(FIXTURES, 'composition.json'), 'utf8')))
    );
    assert.ok(encoded.startsWith('v1.'));
    const { status, stdout } = run(['layout', '--model', 'host', '--composition-state', encoded]);
    assert.equal(status, 0);
    const composed = JSON.parse(stdout);
    assert.deepEqual(
      composed.projects.map((project: { model: string }) => project.model),
      ['host', 'plugin']
    );

    const fromFile = join(root, 'state.json');
    await writeFile(fromFile, await readFile(join(FIXTURES, 'composition.json'), 'utf8'));
    const filed = run(['layout', '--model', 'host', '--composition-state', fromFile]);
    assert.equal(filed.status, 0);
    assert.deepEqual(JSON.parse(filed.stdout).state, composed.state);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an over-limit composition exits nonzero with budget_exceeded', async () => {
  const { root, run } = await fixture();
  try {
    const projects = ['host'];
    for (let index = 0; index < 20; index += 1) projects.push(`fake-${index}`);
    const stateFile = join(root, 'wide.json');
    await writeFile(
      stateFile,
      JSON.stringify({
        version: 1,
        root: 'host',
        projects: projects.map((model) => ({
          model,
          mode: 'open',
          view: { expanded: [], proposed: false, lens: 'structure' }
        })),
        theme: 'grove',
        layout: 'elk-layered'
      })
    );
    const { status, stdout, stderr } = run([
      'layout',
      '--model',
      'host',
      '--composition-state',
      stateFile
    ]);
    assert.notEqual(status, 0);
    assert.equal(stdout, '');
    const failure = JSON.parse(stderr);
    assert.equal(failure.code, 'budget_exceeded');
    assert.deepEqual(failure.diagnostics[0].budget, {
      resource: 'projects',
      actual: 21,
      limit: 20
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('refuses --composition together with --composition-state', async () => {
  const { root, run } = await fixture();
  try {
    const stateFile = join(root, 'state.json');
    await cp(join(FIXTURES, 'composition.json'), stateFile);
    const { status, stdout, stderr } = run([
      'layout',
      '--model',
      'host',
      '--composition',
      'plugins',
      '--composition-state',
      stateFile
    ]);
    assert.notEqual(status, 0);
    assert.equal(stdout, '');
    assert.match(stderr, /--composition and --composition-state are mutually exclusive/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inspect --selection is validated through the state parser rules, not cast', async () => {
  const { root, run } = await fixture();
  try {
    // A well-formed qualified selection inspects through the shared boundary.
    const valid = run([
      'inspect',
      '--model',
      'host',
      '--composition',
      'plugins',
      '--selection',
      JSON.stringify({ kind: 'project', model: 'host' })
    ]);
    assert.equal(valid.status, 0);
    assert.deepEqual((({ kind, model }) => ({ kind, model }))(JSON.parse(valid.stdout)), {
      kind: 'project',
      model: 'host'
    });

    // A malformed selection is a contract diagnostic with a path, exit 1.
    const malformed = run([
      'inspect',
      '--model',
      'host',
      '--composition',
      'plugins',
      '--selection',
      JSON.stringify({ kind: 'element' })
    ]);
    assert.equal(malformed.status, 1);
    assert.equal(malformed.stdout, '');
    assert.match(JSON.parse(malformed.stderr).error, /composition\.selection/);

    const unknownKind = run([
      'inspect',
      '--model',
      'host',
      '--composition',
      'plugins',
      '--selection',
      JSON.stringify({ kind: 'fleet', model: 'host' })
    ]);
    assert.equal(unknownKind.status, 1);
    assert.match(JSON.parse(unknownKind.stderr).error, /composition\.selection\.kind/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
