import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { anchorPathEnv, callerCwd, fromCaller } from '../scripts/caller-cwd';

const CHECKOUT = resolve('.');

/** Run the real `bin/fractal` wrapper from `cwd`, the way a user in another project does. */
function fractal(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(resolve('bin/fractal'), args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  );
}

test('bin/fractal resolves relative --directory and --output against the caller, not the checkout', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fractal-caller-cwd-')));
  const name = `caller-cwd-${process.pid}-${Date.now()}.svg`;
  try {
    await cp('examples/delivery', join(root, 'model'), { recursive: true });

    // The reported repro: `--directory .` from inside the model directory.
    const validated = fractal(join(root, 'model'), ['validate', '--directory', '.', '--json']);
    assert.equal(validated.status, 0, validated.stderr);
    assert.equal(JSON.parse(validated.stdout).valid, true);

    // The quiet one: a relative --output must land beside the caller, never in the checkout.
    const exported = fractal(root, ['export', '--directory', 'model', '--output', name]);
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal(JSON.parse(exported.stdout).output, join(root, name));
    assert.match(await readFile(join(root, name), 'utf8'), /^<svg/);
    assert.equal(await exists(join(CHECKOUT, name)), false, 'nothing is written into the checkout');

    // The same holds for the non-export result writer and for the sequence exporter.
    const inspected = fractal(root, [
      'inspect',
      '--directory',
      './model',
      '--output',
      'model.json'
    ]);
    assert.equal(inspected.status, 0, inspected.stderr);
    assert.equal(JSON.parse(inspected.stdout).output, join(root, 'model.json'));
    assert.equal(await exists(join(CHECKOUT, 'model.json')), false);

    const sequence = fractal(root, [
      'sequence-export',
      '--directory',
      'model',
      '--output',
      'sequence.svg'
    ]);
    assert.equal(sequence.status, 0, sequence.stderr);
    assert.equal(await exists(join(root, 'sequence.svg')), true);
    assert.equal(await exists(join(CHECKOUT, 'sequence.svg')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(join(CHECKOUT, name), { force: true });
  }
});

test('bin/fractal resolves relative --catalog and --composition-state against the caller', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fractal-caller-cwd-')));
  try {
    await cp('examples/delivery', join(root, 'models', 'delivery'), { recursive: true });
    await writeFile(
      join(root, 'catalog.json'),
      JSON.stringify({
        version: 1,
        projects: [{ id: 'delivery', directory: join(root, 'models', 'delivery') }]
      })
    );
    // Neutralize the suite's default so the relative catalog is the only source.
    const projects = fractal(root, ['projects', '--catalog', 'catalog.json', '--json'], {
      FRACTAL_CATALOG: '',
      FRACTAL_MODELS_DIR: ''
    });
    assert.equal(projects.status, 0, projects.stderr);
    assert.deepEqual(
      JSON.parse(projects.stdout).map((project: { id: string }) => project.id),
      ['delivery']
    );

    // Relative env values mean the same file as the flag does.
    const viaEnv = fractal(root, ['projects', '--json'], {
      FRACTAL_CATALOG: 'catalog.json',
      FRACTAL_MODELS_DIR: ''
    });
    assert.equal(viaEnv.status, 0, viaEnv.stderr);
    assert.equal(JSON.parse(viaEnv.stdout)[0].id, 'delivery');

    // A missing state file is reported at the caller's path.
    const state = fractal(root, ['export', '--composition-state', 'missing-state.json']);
    assert.equal(state.status, 1);
    assert.match(JSON.parse(state.stderr).error, new RegExp(join(root, 'missing-state.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('caller-relative resolution falls back to the process directory when no hand-off is set', () => {
  assert.equal(callerCwd({}), process.cwd());
  assert.equal(fromCaller('a/b.svg', {}), resolve('a/b.svg'));
  assert.equal(callerCwd({ FRACTAL_CALLER_CWD: '/tmp/project' }), '/tmp/project');
  assert.equal(
    fromCaller('a/b.svg', { FRACTAL_CALLER_CWD: '/tmp/project' }),
    '/tmp/project/a/b.svg'
  );
  assert.equal(fromCaller('/abs/b.svg', { FRACTAL_CALLER_CWD: '/tmp/project' }), '/abs/b.svg');

  const env: NodeJS.ProcessEnv = {
    FRACTAL_CALLER_CWD: '/tmp/project',
    FRACTAL_CATALOG: 'catalog.json',
    FRACTAL_MODELS_DIR: '/already/absolute',
    FRACTAL_CHROMIUM_PATH: '~/chrome'
  };
  anchorPathEnv(env);
  assert.equal(env.FRACTAL_CATALOG, '/tmp/project/catalog.json');
  assert.equal(env.FRACTAL_MODELS_DIR, '/already/absolute');
  assert.equal(env.FRACTAL_CHROMIUM_PATH, '~/chrome');
  assert.equal(env.XDG_CONFIG_HOME, undefined);
});
