import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const FIXTURES = 'tests/fixtures/linked-projects';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url: string, timeout = 45000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The dev server is still compiling; try again.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Server did not start at ${url}`);
}

async function stop(server: ChildProcess): Promise<void> {
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.on('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
  server.kill('SIGKILL');
}

async function render(base: string, body: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}/api/composition/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, json: await response.json() };
}

/**
 * Process-level proof for revision conflict and reload: a live dev server on a random
 * port with a temp catalog renders a composition, observes a target edit on disk, answers
 * the stale vector with 409, and reloads to the new revision — while a malformed
 * unrelated catalog entry never affects the healthy composition. Typical runtime is well
 * under half a minute; the timeout only guards a hung dev server.
 */
test('revision conflict and reload against a live server', { timeout: 100_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-composition-process-'));
  const models = join(root, 'models');
  await mkdir(models);
  await cp(join(FIXTURES, 'host'), join(models, 'host'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'plugin'), { recursive: true });
  await cp(join(FIXTURES, 'plugin'), join(models, 'broken'), { recursive: true });
  await writeFile(join(models, 'broken', 'model.c4'), 'this is not a LikeC4 model');
  const catalog = join(root, 'catalog.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      projects: [
        { id: 'host', directory: join(models, 'host') },
        { id: 'plugin', directory: join(models, 'plugin') },
        { id: 'broken', directory: join(models, 'broken') },
        { id: 'ghost', directory: join(root, 'ghost') }
      ]
    })
  );

  const port = await freePort();
  const server = spawn(
    'npx',
    ['vite', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: process.cwd(),
      env: { ...process.env, FRACTAL_CATALOG: catalog },
      stdio: ['ignore', 'ignore', 'ignore']
    }
  );
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(`${base}/api/models`);

    // A healthy composition renders despite the malformed unrelated entry.
    const first = await render(base, { root: 'host', composition: 'plugins' });
    assert.equal(first.status, 200);
    assert.deepEqual(
      first.json.composed.projects.map((project: { model: string }) => project.model),
      ['host', 'plugin']
    );
    const revisions = first.json.revisions as Record<string, string>;
    assert.ok(revisions.host && revisions.plugin);

    // Generations echo verbatim for stale-response discard.
    const generated = await render(base, {
      root: 'host',
      composition: 'plugins',
      generation: 3
    });
    assert.equal(generated.status, 200);
    assert.equal(generated.json.generation, 3);

    // Search parity over HTTP: unopened links are metadata, never loaded models.
    const searchResponse = await fetch(
      `${base}/api/composition/search?${new URLSearchParams({
        model: 'host',
        composition: 'plugins',
        q: ''
      })}`
    );
    assert.equal(searchResponse.status, 200);
    const hits = (await searchResponse.json()) as {
      kind: string;
      owner?: string;
      target?: { model: string };
    }[];
    assert.ok(
      hits.some((hit) => hit.kind === 'link' && hit.target?.model === 'missing-plugin'),
      'the unopened target is searchable metadata only'
    );

    // The picker still lists everything, flagging what it cannot use.
    const picker = (await (await fetch(`${base}/api/models`)).json()) as {
      id: string;
      diagnostic?: string;
    }[];
    assert.deepEqual(picker.map((entry) => entry.id).sort(), ['broken', 'ghost', 'host', 'plugin']);
    assert.ok(
      picker.find((entry) => entry.id === 'ghost')?.diagnostic,
      'a missing diagram directory carries a picker diagnostic'
    );

    // Edit the target on disk: the stale vector now conflicts instead of mixing states.
    const pluginSource = join(models, 'plugin', 'model.c4');
    await writeFile(pluginSource, `${await readFile(pluginSource, 'utf8')}\n`);
    const conflict = await render(base, {
      root: 'host',
      composition: 'plugins',
      revisions
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.code, 'revision_changed');
    assert.equal(conflict.json.model, 'plugin');
    assert.equal(conflict.json.expected, revisions.plugin);
    assert.notEqual(conflict.json.actual, revisions.plugin);
    assert.equal(conflict.json.recovery, 'reload');

    // Reload answers with the new revision; the fresh vector is coherent again.
    const reloaded = await render(base, { root: 'host', composition: 'plugins', reload: true });
    assert.equal(reloaded.status, 200);
    assert.notEqual(reloaded.json.revisions.plugin, revisions.plugin);
    assert.equal(reloaded.json.revisions.host, revisions.host);
    const coherent = await render(base, {
      root: 'host',
      composition: 'plugins',
      revisions: reloaded.json.revisions
    });
    assert.equal(coherent.status, 200);
  } finally {
    await stop(server);
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * A reloaded tab starts its generation counter at 1. Generations are client-owned, so a
 * new client (or no client) must still get frames after another caller has already
 * dispatched higher generations for the same root.
 */
test(
  'a composition permalink reload after several renders still gets frames',
  { timeout: 100_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'fractal-composition-reload-'));
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

    const port = await freePort();
    const server = spawn(
      'npx',
      ['vite', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      {
        cwd: process.cwd(),
        env: { ...process.env, FRACTAL_CATALOG: catalog },
        stdio: ['ignore', 'ignore', 'ignore']
      }
    );
    const base = `http://127.0.0.1:${port}`;
    try {
      await waitForServer(`${base}/api/models`);
      const first = await render(base, {
        root: 'host',
        composition: 'plugins',
        client: 'tab-a',
        generation: 1
      });
      assert.equal(first.status, 200);
      assert.notEqual(first.json.status, 'stale');
      const state = first.json.state;
      for (const generation of [2, 3, 4, 5]) {
        const step = await render(base, {
          root: 'host',
          state,
          client: 'tab-a',
          generation
        });
        assert.equal(step.status, 200);
        assert.notEqual(step.json.status, 'stale');
      }
      const reloaded = await render(base, {
        root: 'host',
        state,
        client: 'tab-b',
        generation: 1
      });
      assert.equal(reloaded.status, 200);
      assert.notEqual(reloaded.json.status, 'stale');
      assert.equal(reloaded.json.composed.projects.length, 2);
      const anonymous = await render(base, { root: 'host', state, generation: 1 });
      assert.equal(anonymous.status, 200);
      assert.notEqual(anonymous.json.status, 'stale');
      assert.equal(anonymous.json.composed.projects.length, 2);
    } finally {
      await stop(server);
      await rm(root, { recursive: true, force: true });
    }
  }
);
