import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadDirectory } from '../src/lib/server/models';
import { layoutSequence } from '../src/lib/sequence/layout';
import { renderSequence } from '../src/lib/server/sequence';

const exec = promisify(execFile);

test('optional sequence source participates in revision identity without breaking two-file models', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fractal-sequence-source-'));
  try {
    await cp('examples/delivery/model.c4', join(root, 'model.c4'));
    await cp('examples/delivery/fractal.json', join(root, 'fractal.json'));
    const before = await loadDirectory(root);
    assert.deepEqual(before.sequences, []);
    assert.equal(before.sequenceSource, null);
    const source = await readFile('examples/delivery/sequences.json', 'utf8');
    await writeFile(join(root, 'sequences.json'), source);
    const after = await loadDirectory(root);
    assert.notEqual(after.revision, before.revision);
    assert.equal(after.sequences[0].id, 'order-delivery');
    const changed = JSON.parse(source);
    changed.journeys[0].description = 'Changed authored explanation';
    await writeFile(join(root, 'sequences.json'), JSON.stringify(changed));
    assert.notEqual((await loadDirectory(root)).revision, after.revision);
    await writeFile(join(root, 'sequences.json'), '{ broken');
    await assert.rejects(loadDirectory(root));
    await rm(join(root, 'sequences.json'));
    assert.equal((await loadDirectory(root)).revision, before.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI and HTTP application boundary share sequence projection and stale-source refusal', async () => {
  const loaded = await loadDirectory('examples/delivery');
  const state = {
    collapsedPhases: ['fulfillment'],
    collapsedGroups: ['warehouse'],
    hiddenParticipants: [],
    theme: 'midnight' as const
  };
  const expected = layoutSequence(loaded.sequences[0], state);
  const server = await renderSequence({
    model: 'delivery',
    journey: 'order-delivery',
    state,
    revision: loaded.revision
  });
  assert.deepEqual(server.diagram, expected);
  await assert.rejects(
    renderSequence({ model: 'delivery', journey: 'order-delivery', revision: 'stale' }),
    /changed on disk/
  );
  await assert.rejects(
    renderSequence({ model: 'delivery', journey: 'missing' }),
    /Unknown journey/
  );
  const { stdout } = await exec(resolve('bin/fractal'), [
    'sequence',
    '--directory',
    resolve('examples/delivery'),
    '--journey',
    'order-delivery',
    '--collapsed-phases',
    'fulfillment',
    '--collapsed-groups',
    'warehouse',
    '--theme',
    'midnight',
    '--json'
  ]);
  assert.deepEqual(JSON.parse(stdout), expected);
  const inspection = await exec(resolve('bin/fractal'), [
    'journey',
    '--directory',
    resolve('examples/delivery'),
    '--journey',
    'order-delivery',
    '--collapsed-phases',
    'not-a-phase',
    '--json'
  ]);
  assert.deepEqual(JSON.parse(inspection.stdout), loaded.sequences[0]);
});

test('journey discovery and inspection offer human-readable output independently of layout flags', async () => {
  const base = ['--directory', resolve('examples/delivery')];
  const list = await exec(resolve('bin/fractal'), ['journeys', ...base]);
  assert.match(list.stdout, /From order to delivery \[current\]/);
  const detail = await exec(resolve('bin/fractal'), [
    'journey',
    ...base,
    '--collapsed-phases',
    'irrelevant'
  ]);
  assert.match(detail.stdout, /6 participants/);
  const structured = await exec(resolve('bin/fractal'), ['journeys', ...base, '--json']);
  assert.equal(JSON.parse(structured.stdout)[0].status, 'current');
});
