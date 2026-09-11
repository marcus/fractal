import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadModel, listModels } from '../src/lib/server/models';

test('external model roots load project-owned models without changing bundled examples', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-model-root-'));
  const previous = process.env.FRACTAL_MODELS_DIR;
  try {
    await cp('examples/observatory', join(root, 'client-system'), { recursive: true });
    process.env.FRACTAL_MODELS_DIR = root;
    const catalog = await listModels();
    assert.deepEqual(
      catalog.map((m) => m.id),
      ['client-system']
    );
    const loaded = await loadModel('client-system');
    assert.equal(loaded.model.title, 'Observatory');
    assert.match(loaded.revision, /^[a-f0-9]{64}$/);
    await assert.rejects(loadModel('../delivery'), /Invalid model identifier/);
  } finally {
    if (previous === undefined) delete process.env.FRACTAL_MODELS_DIR;
    else process.env.FRACTAL_MODELS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
