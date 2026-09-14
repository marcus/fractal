import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resetCompositionState } from '../src/lib/server/composition';
import { POST } from '../src/routes/api/export/+server';

const FIXTURES = 'tests/fixtures/linked-projects';

type PostEvent = Parameters<typeof POST>[0];

/** A catalog with a healthy host, a healthy plugin and a deliberately missing entry. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fractal-export-route-'));
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
  const previous = process.env.FRACTAL_CATALOG;
  process.env.FRACTAL_CATALOG = catalog;
  resetCompositionState();
  return {
    root,
    restore: () => {
      if (previous === undefined) delete process.env.FRACTAL_CATALOG;
      else process.env.FRACTAL_CATALOG = previous;
      resetCompositionState();
    }
  };
}

function post(body: unknown): PostEvent {
  const request = new Request('http://localhost/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return { request } as PostEvent;
}

const openState = (extra: string[] = []) => ({
  version: 1,
  root: 'host',
  projects: ['host', 'plugin', ...extra].map((model) => ({
    model,
    mode: 'open',
    view: { expanded: [], proposed: false, lens: 'structure' }
  })),
  theme: 'grove',
  layout: 'elk-layered'
});

test('malformed composition selectors are 400, never a silent root-only export', async () => {
  const { root, restore } = await fixture();
  try {
    for (const composition of [42, { id: 'plugins' }, null, true]) {
      const response = await POST(post({ model: 'host', composition }));
      assert.equal(response.status, 400, `composition ${String(composition)}`);
      assert.deepEqual(await response.json(), { error: 'composition must be a string' });
    }
    for (const compositionState of [42, true]) {
      const response = await POST(post({ model: 'host', compositionState }));
      assert.equal(response.status, 400, `compositionState ${String(compositionState)}`);
      assert.deepEqual(await response.json(), {
        error: 'compositionState must be a decoded state object or a v1. value'
      });
    }
    for (const allowUnresolved of ['yes', 1]) {
      const response = await POST(post({ model: 'host', composition: 'plugins', allowUnresolved }));
      assert.equal(response.status, 400, `allowUnresolved ${String(allowUnresolved)}`);
      assert.deepEqual(await response.json(), { error: 'allowUnresolved must be a boolean' });
    }
  } finally {
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed participant fails the export with 422 by default', async () => {
  const { root, restore } = await fixture();
  try {
    const response = await POST(
      post({ model: 'host', compositionState: openState(['missing-plugin']) })
    );
    assert.equal(response.status, 422);
    const failure = await response.json();
    assert.equal(failure.code, 'export_unresolved');
    assert.equal(failure.diagnostics[0].code, 'model_unavailable');
  } finally {
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

test('a composition export returns artwork plus a decodable manifest header', async () => {
  const { root, restore } = await fixture();
  try {
    const response = await POST(post({ model: 'host', composition: 'plugins' }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    assert.equal(
      response.headers.get('content-disposition'),
      'attachment; filename="host-composition.svg"'
    );
    const artwork = await response.text();
    assert.ok(artwork.includes('data-node-id="host:core"'));
    assert.ok(artwork.includes('data-node-id="plugin:core"'));
    const header = response.headers.get('x-fractal-export-manifest');
    assert.ok(header, 'the manifest travels in the response header');
    const manifest = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    assert.equal(manifest.version, 1);
    assert.equal(manifest.format, 'svg');
    assert.equal(manifest.root, 'host');
    assert.equal(manifest.composition, 'plugins');
    assert.deepEqual(
      manifest.projects.map((project: { model: string }) => project.model),
      ['host', 'plugin']
    );
    assert.ok(
      (manifest.omitted as { target: { model: string } }[]).some(
        (entry) => entry.target.model === 'missing-plugin'
      )
    );
    assert.deepEqual(manifest.unresolved, []);
  } finally {
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

test('a non-JSON body keeps the exact single-model error and the new composition error', async () => {
  const { root, restore } = await fixture();
  try {
    // Single-model: byte-identical to the historical `{ error: String(parseError) }` shape.
    const probe = new Request('http://localhost/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json{'
    });
    const expected = await probe.json().then(
      () => assert.fail('probe body must not parse'),
      (error) => String(error)
    );
    const single = await POST(post('not json{'));
    assert.equal(single.status, 400);
    assert.equal(await single.text(), JSON.stringify({ error: expected }));

    // Composition-shaped: the explicit parse diagnostic.
    const composed = await POST(post('{"model":"host","composition":'));
    assert.equal(composed.status, 400);
    assert.deepEqual(await composed.json(), { error: 'Request body must be JSON.' });
  } finally {
    restore();
    await rm(root, { recursive: true, force: true });
  }
});
