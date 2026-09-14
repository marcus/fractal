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
    await cp('examples/observatory', join(root, 'observatory'), { recursive: true });
    process.env.FRACTAL_MODELS_DIR = root;
    const catalog = await listModels();
    assert.deepEqual(
      catalog.map((m) => m.id),
      ['observatory']
    );
    const loaded = await loadModel('observatory');
    assert.equal(loaded.model.title, 'Observatory');
    assert.match(loaded.revision, /^[a-f0-9]{64}$/);
    await assert.rejects(loadModel('../delivery'), /Invalid model identifier/);
  } finally {
    if (previous === undefined) delete process.env.FRACTAL_MODELS_DIR;
    else process.env.FRACTAL_MODELS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('a models-directory entry named differently from its companion id is invalid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-model-root-'));
  const previous = process.env.FRACTAL_MODELS_DIR;
  try {
    // The directory name must never select the identity: the companion still
    // calls itself `observatory`, so `client-system` cannot load as a model.
    await cp('examples/observatory', join(root, 'client-system'), { recursive: true });
    process.env.FRACTAL_MODELS_DIR = root;
    await assert.rejects(
      loadModel('client-system'),
      /does not match companion model ID observatory/
    );
    const catalog = await listModels();
    assert.deepEqual(
      catalog.map((m) => m.id),
      ['client-system']
    );
    assert.match(catalog[0].diagnostic ?? '', /does not match companion model ID observatory/);
  } finally {
    if (previous === undefined) delete process.env.FRACTAL_MODELS_DIR;
    else process.env.FRACTAL_MODELS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
