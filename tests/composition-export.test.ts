import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parseModel } from '../src/lib/adapters/likec4';
import { compose } from '../src/lib/composition/compose';
import { parseCompositionState, parseLinks } from '../src/lib/composition/parse';
import { staticResolver } from '../src/lib/composition/snapshot';
import type { ProjectSnapshot } from '../src/lib/composition/snapshot';
import type {
  CompositionState,
  IdentityOrigins,
  ProjectConnection
} from '../src/lib/composition/types';
import { exportCompositionSvg } from '../src/lib/composition/svg';
import { layout } from '../src/lib/core/layout';
import { getTheme } from '../src/lib/core/themes';
import { exportSvg, escapeXml, formatSvgNumber } from '../src/lib/core/svg';
import { buildExportManifest, omittedLinks, unresolvedTargets } from '../src/lib/server/export';

const FIXTURES = 'tests/fixtures/linked-projects';

const fixture = (path: string) =>
  readFile(new URL(`./fixtures/linked-projects/${path}`, import.meta.url), 'utf8');
const json = async (path: string) => JSON.parse(await fixture(path));

async function snapshot(id: 'host' | 'plugin' | 'third'): Promise<ProjectSnapshot> {
  const source = await fixture(`${id}/model.c4`);
  const model = await parseModel(source, await json(`${id}/fractal.json`));
  assert.equal(model.id, id);
  return {
    id,
    model,
    links: parseLinks(await json(`${id}/links.json`), id),
    origins: (await json(`${id}/identity-origins.expected.json`)) as IdentityOrigins,
    revision: createHash('sha256').update(`${id}:${source}`).digest('hex')
  };
}

const view = (expanded: string[] = [], proposed = false, scope?: string) => ({
  expanded,
  proposed,
  lens: 'structure' as const,
  ...(scope === undefined ? {} : { scope })
});

function stateOf(
  projects: CompositionState['projects'],
  layoutId: CompositionState['layout'] = 'elk-layered'
): CompositionState {
  return parseCompositionState({
    version: 1,
    root: 'host',
    projects,
    theme: 'grove',
    layout: layoutId
  });
}

const openThree = (): CompositionState =>
  stateOf([
    { model: 'host', scene: 'detail', mode: 'open', view: view(['core']) },
    { model: 'plugin', scene: 'detail', mode: 'open', view: view(['core']) },
    { model: 'third', scene: 'detail', mode: 'open', view: view(['core']) }
  ]);

const modelsOf = (snapshots: ProjectSnapshot[]) =>
  Object.fromEntries(snapshots.map((snapshot) => [snapshot.id, snapshot.model]));

function idsOf(svg: string): string[] {
  return [...svg.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
}

test('composed SVG namespaces ids and renders every colliding cli node', async () => {
  const snapshots = await Promise.all([snapshot('host'), snapshot('plugin'), snapshot('third')]);
  const composed = await compose(staticResolver(snapshots), openThree());
  const svg = exportCompositionSvg(composed, modelsOf(snapshots));

  const ids = idsOf(svg);
  assert.deepEqual(new Set(ids).size, ids.length, `duplicate ids: ${ids}`);
  for (const model of ['host', 'plugin', 'third'])
    assert.ok(
      svg.includes(`data-node-id="${model}:cli"`),
      `expected the ${model} cli card, both cli nodes render`
    );
  // One shared arrow marker pair, never per-project marker ids.
  assert.equal((svg.match(/<marker/g) ?? []).length, 2);
  assert.ok(svg.includes('id="cmp-arrow"'));
  assert.ok(!svg.includes('composition-arrow'));
});

test('composed SVG includes all offscreen content with no viewport culling', async () => {
  const snapshots = await Promise.all([snapshot('host'), snapshot('plugin'), snapshot('third')]);
  const composed = await compose(staticResolver(snapshots), openThree());
  const svg = exportCompositionSvg(composed, modelsOf(snapshots));

  const expected = composed.projects.flatMap(
    (project) =>
      project.diagram?.nodes.map((node) => `data-node-id="${project.model}:${node.id}"`) ?? []
  );
  assert.ok(expected.length > 0);
  for (const marker of expected) assert.ok(svg.includes(marker), `missing ${marker}`);
  assert.ok(svg.includes('data-export-layer="title"'));
  assert.ok(svg.includes('data-export-layer="subtitle"'));
  assert.ok(svg.includes('data-export-layer="diagram"'));
  assert.ok(svg.includes('data-export-layer="footer"'));
});

test('composed SVG page framing uses the theme canvas and names participating projects', async () => {
  const snapshots = await Promise.all([snapshot('host'), snapshot('plugin'), snapshot('third')]);
  const models = modelsOf(snapshots);
  for (const themeId of ['grove', 'graphite', 'midnight'] as const) {
    const composed = await compose(
      staticResolver(snapshots),
      parseCompositionState({ ...openThree(), theme: themeId })
    );
    const svg = exportCompositionSvg(composed, models);
    const theme = getTheme(themeId);
    assert.ok(svg.includes(`data-theme="${themeId}"`));
    assert.ok(svg.includes(`fill="${theme.canvas}"`));
    assert.ok(svg.includes('Harbor host'));
    assert.ok(svg.includes('Beacon plugin / detail'));
    assert.ok(svg.includes('Relay plugin / detail'));
    assert.ok(svg.includes('host · plugin · third'));
    assert.ok(svg.includes('FRACTAL / LINKED COMPOSITION'));
    assert.ok(svg.includes('id="cmp-title"'));
    assert.ok(svg.includes('id="cmp-arrow"'));
    assert.equal(svg, exportCompositionSvg(composed, models), `${themeId} is deterministic`);
  }
});

test('bridge arrows end at the target point with the claim label', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const composed = await compose(
    staticResolver([host, plugin]),
    stateOf([
      { model: 'host', scene: 'overview', mode: 'open', view: view() },
      { model: 'plugin', scene: 'overview', mode: 'open', view: view() }
    ])
  );
  const svg = exportCompositionSvg(composed, modelsOf([host, plugin]));
  const bridge = composed.bridges.find((entry) => entry.owner === 'host')!;
  const group = svg.match(
    /<g data-connection-owner="host" data-connection-id="call"[^>]*><path d="([^"]+)"[^>]*marker-end="([^"]+)"/
  );
  assert.ok(group, 'host bridge path with an arrowhead marker');
  const [, d, marker] = group;
  assert.equal(marker, 'url(#cmp-arrow)');
  const last = bridge.points[bridge.points.length - 1];
  assert.deepEqual(last, bridge.target.point);
  assert.ok(
    d.endsWith(`L${formatSvgNumber(last.x)},${formatSvgNumber(last.y)}`),
    `bridge path ends at its target point: ${d}`
  );
  assert.ok(svg.includes('Invokes plugin CLI'));
});

test('bundled bridges carry the count in the exported label', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const extra: ProjectConnection = {
    ...host.links!.connections[0],
    id: 'call-twice'
  };
  const doubled: ProjectSnapshot = {
    ...host,
    links: { ...host.links!, connections: [...host.links!.connections, extra] }
  };
  const composed = await compose(
    staticResolver([doubled, plugin]),
    stateOf([
      { model: 'host', scene: 'overview', mode: 'open', view: view() },
      { model: 'plugin', scene: 'overview', mode: 'open', view: view() }
    ])
  );
  const bundled = composed.bridges.find((entry) => entry.owner === 'host')!;
  assert.equal(bundled.count, 2);
  const svg = exportCompositionSvg(composed, modelsOf([doubled, plugin]));
  assert.ok(svg.includes('×2'), 'the shared bridge label shows the bundle count');
});

test('unopened links draw not-opened cards and collapsed projects draw summaries', async () => {
  const snapshots = await Promise.all([snapshot('host'), snapshot('plugin'), snapshot('third')]);
  const composed = await compose(staticResolver(snapshots), openThree());
  const svg = exportCompositionSvg(composed, modelsOf(snapshots));
  assert.ok(svg.includes('Diagram not opened'));
  assert.ok(svg.includes('Unregistered plugin'));

  const collapsed = await compose(
    staticResolver(snapshots),
    stateOf([
      { model: 'host', scene: 'overview', mode: 'open', view: view() },
      { model: 'plugin', scene: 'overview', mode: 'collapsed', view: view() },
      { model: 'third', scene: 'overview', mode: 'open', view: view() }
    ])
  );
  const collapsedSvg = exportCompositionSvg(collapsed, modelsOf(snapshots));
  assert.ok(collapsedSvg.includes('data-project-mode="collapsed"'));
  assert.ok(collapsedSvg.includes('Collapsed summary'));
});

test('scope-excluded endpoints draw labeled perimeter ports, distinct from components', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const composed = await compose(
    staticResolver([host, plugin]),
    stateOf([
      { model: 'host', scene: 'overview', mode: 'open', view: view() },
      { model: 'plugin', scene: 'overview', mode: 'open', view: view([], false, 'store') }
    ])
  );
  assert.ok(
    composed.projects.find((project) => project.model === 'plugin')!.ports.length >= 1,
    'the scoped plugin exposes a perimeter port'
  );
  const svg = exportCompositionSvg(composed, modelsOf([host, plugin]));
  assert.ok(svg.includes('data-port-model="plugin"'));
  assert.ok(svg.includes('outside scope'));
});

test('a failed participating target is unresolved while unopened links are omitted', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const composed = await compose(
    staticResolver([host, plugin]),
    stateOf([
      { model: 'host', scene: 'overview', mode: 'open', view: view() },
      { model: 'plugin', scene: 'overview', mode: 'open', view: view() },
      { model: 'missing-plugin', mode: 'open', view: view() }
    ])
  );
  const unresolved = unresolvedTargets(composed);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].code, 'model_unavailable');
  assert.deepEqual(unresolved[0].target, { model: 'missing-plugin' });

  const omitted = omittedLinks(composed);
  assert.ok(
    omitted.every((entry) => entry.target.model !== 'missing-plugin'),
    'a failed participant is unresolved, never an intentional omission'
  );
});

test('the manifest carries projects with revisions, state, omissions and format', async () => {
  const snapshots = await Promise.all([snapshot('host'), snapshot('plugin'), snapshot('third')]);
  const composed = await compose(staticResolver(snapshots), openThree());
  const revisions = Object.fromEntries(
    snapshots.map((snapshot) => [snapshot.id, snapshot.revision])
  );
  const manifest = buildExportManifest(composed, revisions, 'svg', '/tmp/composed.svg');

  assert.equal(manifest.version, 1);
  assert.equal(manifest.format, 'svg');
  assert.equal(manifest.root, 'host');
  assert.equal(manifest.output, '/tmp/composed.svg');
  assert.deepEqual(
    manifest.projects.map((project) => project.model),
    ['host', 'plugin', 'third']
  );
  for (const project of manifest.projects) assert.equal(project.revision, revisions[project.model]);
  assert.deepEqual(manifest.state, composed.state);
  assert.ok(
    manifest.omitted.some((entry) => entry.target.model === 'missing-plugin'),
    'unopened links are intentional omissions'
  );
  assert.deepEqual(manifest.unresolved, []);
});

test('composed export is deterministic for the same input', async () => {
  const snapshots = await Promise.all([snapshot('host'), snapshot('plugin'), snapshot('third')]);
  const models = modelsOf(snapshots);
  const first = exportCompositionSvg(await compose(staticResolver(snapshots), openThree()), models);
  const second = exportCompositionSvg(
    await compose(staticResolver(snapshots), openThree()),
    models
  );
  assert.equal(first, second);
});

test('single-model export is unchanged: one arrow marker and no composition ids', async () => {
  const host = await snapshot('host');
  const scene = host.model.scenes[0];
  const svg = exportSvg(
    host.model,
    await layout(host.model, {
      expanded: scene.expanded,
      proposed: scene.proposed,
      lens: scene.lens
    })
  );
  assert.equal((svg.match(/<marker/g) ?? []).length, 1);
  assert.ok(svg.includes('id="arrow"'));
  assert.ok(!svg.includes('cmp-'));
  assert.equal(escapeXml('<a>&"\' catch'), '&lt;a&gt;&amp;&quot;&apos; catch');
});

async function cliFixture() {
  const root = await mkdtemp(join(tmpdir(), 'fractal-composition-export-'));
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
  const run = (args: string[]) => {
    const result = spawnSync(resolve('bin/fractal'), args, {
      encoding: 'utf8',
      env: { ...process.env, FRACTAL_CATALOG: catalog }
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  return { root, run };
}

test('CLI export writes composed SVG and prints the manifest report', async () => {
  const { root, run } = await cliFixture();
  try {
    const output = join(root, 'composed.svg');
    const { status, stdout, stderr } = run([
      'export',
      '--model',
      'host',
      '--composition',
      'plugins',
      '--format',
      'svg',
      '--output',
      output
    ]);
    assert.equal(status, 0, stderr);
    const manifest = JSON.parse(stdout);
    assert.equal(manifest.version, 1);
    assert.equal(manifest.format, 'svg');
    assert.equal(manifest.output, output);
    assert.deepEqual(
      manifest.projects.map((project: { model: string }) => project.model),
      ['host', 'plugin']
    );
    for (const project of manifest.projects as { model: string; revision: string }[])
      assert.match(project.revision, /^[0-9a-f]{64}$/);
    assert.deepEqual(manifest.unresolved, []);
    assert.ok(
      (manifest.omitted as { target: { model: string } }[]).some(
        (entry) => entry.target.model === 'missing-plugin'
      )
    );
    const svg = await readFile(output, 'utf8');
    assert.ok(svg.includes('data-node-id="host:core"'));
    assert.ok(svg.includes('data-node-id="plugin:core"'));
    assert.ok(svg.includes('Diagram not opened'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI export without --output keeps artwork on stdout and the manifest on stderr', async () => {
  const { root, run } = await cliFixture();
  try {
    const { status, stdout, stderr } = run([
      'export',
      '--model',
      'host',
      '--composition',
      'plugins',
      '--json'
    ]);
    assert.equal(status, 0, stderr);
    assert.ok(stdout.startsWith('<svg'));
    const manifest = JSON.parse(stderr);
    assert.equal(manifest.format, 'svg');
    assert.ok(!('output' in manifest));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI export fails by default for a failed participant and succeeds with --allow-unresolved', async () => {
  const { root, run } = await cliFixture();
  try {
    const stateFile = join(root, 'state.json');
    await writeFile(
      stateFile,
      JSON.stringify({
        version: 1,
        root: 'host',
        projects: [
          {
            model: 'host',
            mode: 'open',
            view: { expanded: [], proposed: false, lens: 'structure' }
          },
          {
            model: 'plugin',
            mode: 'open',
            view: { expanded: [], proposed: false, lens: 'structure' }
          },
          {
            model: 'missing-plugin',
            mode: 'open',
            view: { expanded: [], proposed: false, lens: 'structure' }
          }
        ],
        theme: 'grove',
        layout: 'elk-layered'
      })
    );
    const refused = run([
      'export',
      '--model',
      'host',
      '--composition-state',
      stateFile,
      '--output',
      join(root, 'refused.svg')
    ]);
    assert.notEqual(refused.status, 0);
    const failure = JSON.parse(refused.stderr);
    assert.equal(failure.code, 'export_unresolved');
    assert.equal(failure.diagnostics[0].code, 'model_unavailable');

    const output = join(root, 'unresolved.svg');
    const allowed = run([
      'export',
      '--model',
      'host',
      '--composition-state',
      stateFile,
      '--allow-unresolved',
      '--output',
      output
    ]);
    assert.equal(allowed.status, 0, allowed.stderr);
    const manifest = JSON.parse(allowed.stdout);
    assert.equal(manifest.unresolved.length, 1);
    assert.equal(manifest.unresolved[0].code, 'model_unavailable');
    const svg = await readFile(output, 'utf8');
    assert.ok(svg.includes('Diagram unavailable'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI export rejects html for compositions and png without --output', async () => {
  const { root, run } = await cliFixture();
  try {
    const html = run(['export', '--model', 'host', '--composition', 'plugins', '--format', 'html']);
    assert.notEqual(html.status, 0);
    assert.match(html.stderr, /Composition export format must be svg or png/);
    const png = run(['export', '--model', 'host', '--composition', 'plugins', '--format', 'png']);
    assert.notEqual(png.status, 0);
    assert.match(png.stderr, /PNG export requires --output/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
