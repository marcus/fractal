import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parseModel } from '../src/lib/adapters/likec4';
import { layout } from '../src/lib/adapters/elk-layout';
import { project } from '../src/lib/core/projection';
import { exportSvg } from '../src/lib/core/svg';
import { getTheme, THEMES } from '../src/lib/core/themes';
import type { Model, ViewState } from '../src/lib/core/types';

const state: ViewState = { expanded: [], proposed: false, lens: 'structure' };
const model: Model = {
  version: 1,
  id: 'themes',
  title: 'Theme proof',
  description: 'A portable themed diagram.',
  provenance: 'test',
  elements: [
    {
      id: 'node',
      sourceId: 'node',
      parent: null,
      title: 'Node',
      kind: 'service',
      description: 'Visible in every palette.',
      technology: '',
      status: 'current',
      color: '#739886',
      evidence: []
    }
  ],
  relationships: [],
  boundaries: [],
  scenes: []
};

test('Grove is the stable default and old view states remain valid', () => {
  assert.equal(getTheme().id, 'grove');
  assert.deepEqual(
    THEMES.map(({ id, name, appearance }) => ({ id, name, appearance })),
    [
      { id: 'grove', name: 'Grove', appearance: 'light' },
      { id: 'graphite', name: 'Graphite', appearance: 'light' },
      { id: 'midnight', name: 'Midnight', appearance: 'dark' }
    ]
  );
  assert.deepEqual(
    project(model, state).elements.map((element) => element.id),
    ['node']
  );
});

test('shared theme validation rejects invalid view state and direct lookup', () => {
  assert.throws(() => getTheme('neon'), /Unknown theme: neon/);
  assert.throws(
    () => project(model, { ...state, theme: 'neon' as ViewState['theme'] }),
    /Unknown theme: neon/
  );
});

test('LikeC4 preserves an authored scene theme and rejects unknown theme IDs', async () => {
  const source = `
    specification { element component }
    model { node = component 'Node' { metadata { uid 'node' } } }
  `;
  const companion = (theme?: string) => ({
    version: 1,
    id: 'themes',
    title: 'Theme proof',
    description: '',
    provenance: 'test',
    boundaries: [],
    scenes: [
      {
        id: 'overview',
        title: 'Overview',
        description: '',
        expanded: [],
        proposed: false,
        lens: 'structure',
        ...(theme ? { theme } : {})
      }
    ]
  });
  assert.equal((await parseModel(source, companion('midnight'))).scenes[0].theme, 'midnight');
  assert.equal((await parseModel(source, companion())).scenes[0].theme, undefined);
  await assert.rejects(parseModel(source, companion('neon')), /Unknown theme: neon/);
});

test('Midnight drives portable SVG surfaces and readable labels', async () => {
  const theme = getTheme('midnight');
  const diagram = await layout(model, { ...state, theme: 'midnight' });
  const svg = exportSvg(model, diagram);
  assert.match(svg, /data-theme="midnight" data-theme-appearance="dark"/);
  assert.match(svg, new RegExp(`<rect width="1920" height="1080" fill="${theme.canvas}"`));
  assert.match(svg, new RegExp(`fill="${theme.card}"`));
  assert.match(svg, new RegExp(`fill="${theme.text}"`));
  // The kind is a Roc icon in the accent, titled for readers of the raw SVG.
  assert.match(svg, new RegExp(`color="${theme.accent}"[^>]*><title>Service</title>`));
  assert.ok(!svg.includes('foreignObject'));
});

test('CLI exposes theme metadata and rejects an invalid export theme', () => {
  const metadata = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/fractal.ts', 'themes', '--json'],
    {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8'
    }
  );
  assert.equal(metadata.status, 0, metadata.stderr);
  assert.deepEqual(
    JSON.parse(metadata.stdout).map((theme: { id: string }) => theme.id),
    ['grove', 'graphite', 'midnight']
  );
  const invalid = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/fractal.ts', 'export', '--theme', 'neon'],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' }
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown theme: neon/);
});
