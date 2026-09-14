import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseModel } from '../src/lib/adapters/likec4';
import { compose } from '../src/lib/composition/compose';
import { inspectQualified } from '../src/lib/composition/inspect';
import { parseCompositionState, parseLinks } from '../src/lib/composition/parse';
import {
  focusProject,
  openProject,
  setProjectScope,
  setProjectScene,
  stateFromComposition
} from '../src/lib/composition/state';
import type { ProjectSnapshot } from '../src/lib/composition/snapshot';
import { staticResolver } from '../src/lib/composition/snapshot';
import type {
  CompositionState,
  Frame,
  IdentityOrigins,
  ProjectConnection
} from '../src/lib/composition/types';
import { wrapText } from '../src/lib/core/projection';
import { EDGE_LABEL_SIZE, EDGE_LABEL_WIDTH } from '../src/lib/core/measure';
import type { Element, Model, Point } from '../src/lib/core/types';

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
    { model: 'host', scene: 'overview', mode: 'open', view: view() },
    { model: 'plugin', scene: 'overview', mode: 'open', view: view() },
    { model: 'third', scene: 'overview', mode: 'open', view: view() }
  ]);

const withConnection = (
  snapshot: ProjectSnapshot,
  connection: ProjectConnection
): ProjectSnapshot => ({
  ...snapshot,
  links: snapshot.links
    ? { ...snapshot.links, connections: [...snapshot.links.connections, connection] }
    : snapshot.links
});

const titleBand = (project: { frame: Frame; titleHeight: number }): Frame => ({
  x: project.frame.x,
  y: project.frame.y,
  width: project.frame.width,
  height: project.titleHeight
});

/** True when an orthogonal segment overlaps the interior of a rectangle (a touch is not a cross). */
function crossesRect(a: Point, b: Point, rect: Frame): boolean {
  if (a.x === b.x)
    return (
      a.x > rect.x &&
      a.x < rect.x + rect.width &&
      Math.max(a.y, b.y) > rect.y &&
      Math.min(a.y, b.y) < rect.y + rect.height
    );
  if (a.y === b.y)
    return (
      a.y > rect.y &&
      a.y < rect.y + rect.height &&
      Math.max(a.x, b.x) > rect.x &&
      Math.min(a.x, b.x) < rect.x + rect.width
    );
  return false;
}

test('an endpoint outside the scene scope draws a labeled perimeter port with a reveal action', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  const stock: ProjectConnection = {
    id: 'stock',
    source: { model: 'host', element: 'cli' },
    target: { model: 'plugin', element: 'store' },
    title: 'Reads plugin records',
    kind: 'reads',
    status: 'current',
    description: 'Fictional stock check against the plugin store.',
    evidence: []
  };
  const state = stateOf([
    { model: 'host', scene: 'overview', mode: 'open', view: view() },
    { model: 'plugin', scene: 'overview', mode: 'open', view: view([], false, 'core') },
    { model: 'third', scene: 'overview', mode: 'open', view: view() }
  ]);
  const composed = await compose(
    staticResolver([withConnection(host, stock), plugin, third]),
    state
  );

  const bridge = composed.bridges.find((candidate) => candidate.id === 'stock')!;
  assert.deepEqual(bridge.target.representative, { kind: 'port', reason: 'outside-scope' });
  assert.deepEqual(bridge.source.representative, { kind: 'node', id: 'core' });

  const pluginProject = composed.projects.find((project) => project.model === 'plugin')!;
  assert.equal(pluginProject.ports.length, 1);
  const [port] = pluginProject.ports;
  assert.equal(port.model, 'plugin');
  // The plugin frame sits right of the host, so the port faces left toward the host.
  assert.equal(port.side, 'left');
  assert.equal(port.point.x, pluginProject.frame.x);
  assert.ok(
    port.point.y > pluginProject.frame.y + pluginProject.titleHeight &&
      port.point.y < pluginProject.frame.y + pluginProject.frame.height
  );
  assert.equal(port.count, 1);
  assert.deepEqual(port.reveal, { model: 'plugin', element: 'store' });
  assert.deepEqual(port.labelLines, wrapText('Plugin records', EDGE_LABEL_WIDTH, EDGE_LABEL_SIZE));
  // The bridge ends exactly at the port.
  assert.deepEqual(bridge.target.point, port.point);
});

test('ports on one side share the side and keep distinct reveal slots', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  const stock: ProjectConnection = {
    id: 'stock',
    source: { model: 'host', element: 'cli' },
    target: { model: 'plugin', element: 'cli' },
    title: 'Counts plugin checkouts',
    kind: 'reads',
    status: 'current',
    description: 'Same endpoints as the host claim with a different title.',
    evidence: []
  };
  const hub: ProjectConnection = {
    id: 'hub',
    source: { model: 'host', element: 'core' },
    target: { model: 'plugin', element: 'cli' },
    title: 'Hosts the plugin core',
    kind: 'hosts',
    status: 'current',
    description: 'A second out-of-scope endpoint on the same side.',
    evidence: []
  };
  const state = stateOf([
    { model: 'host', scene: 'overview', mode: 'open', view: view([], false, 'store') },
    { model: 'plugin', scene: 'overview', mode: 'open', view: view() },
    { model: 'third', scene: 'overview', mode: 'open', view: view() }
  ]);
  const withExtras: ProjectSnapshot = {
    ...host,
    links: host.links
      ? { ...host.links, connections: [...host.links.connections, stock, hub] }
      : host.links
  };
  const composed = await compose(staticResolver([withExtras, plugin, third]), state);

  const hostProject = composed.projects.find((project) => project.model === 'host')!;
  assert.equal(hostProject.ports.length, 2);
  const [first, second] = hostProject.ports;
  // Both face the plugin on the right; slots are ordered by element and never overlap.
  assert.deepEqual([first.side, second.side], ['right', 'right']);
  assert.deepEqual(
    [first.reveal, second.reveal],
    [
      { model: 'host', element: 'cli' },
      { model: 'host', element: 'core' }
    ]
  );
  assert.equal(first.point.x, hostProject.frame.x + hostProject.frame.width);
  assert.equal(second.point.x, hostProject.frame.x + hostProject.frame.width);
  assert.ok(first.point.y < second.point.y);
  // The cli port serves four claims (host/call, stock, and the plugin/third targets); core serves one.
  assert.equal(first.count, 4);
  assert.equal(second.count, 1);
  assert.deepEqual(
    first.labelLines,
    wrapText('Plugin adapter ×4', EDGE_LABEL_WIDTH, EDGE_LABEL_SIZE)
  );
  // Every bridge through the shared port ends at the same slot.
  const ends = composed.bridges
    .filter((bridge) => bridge.source.representative.kind === 'port')
    .map((bridge) => bridge.source.point);
  assert.ok(ends.length >= 2);
  for (const point of ends) {
    const slot = hostProject.ports.find(
      (port) => port.point.x === point.x && port.point.y === point.y
    );
    assert.ok(slot, 'every port-routed bridge ends at a listed port slot');
  }
});

test('collapse resolves to an ancestor while scope exclusion draws a port', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const collapsed = await compose(
    staticResolver([host, plugin]),
    stateOf([
      { model: 'host', scene: 'overview', mode: 'open', view: view() },
      { model: 'plugin', scene: 'overview', mode: 'open', view: view() }
    ])
  );
  const bridge = collapsed.bridges.find((candidate) => candidate.owner === 'host')!;
  // cli is hidden by the collapsed ancestor, not by scope: it resolves to the core card.
  assert.deepEqual(bridge.source.representative, { kind: 'node', id: 'core' });
  assert.deepEqual(
    collapsed.projects.flatMap((project) => project.ports),
    []
  );
});

test('a proposed claim whose owner filters proposed content is hidden, never ported', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  const composed = await compose(staticResolver([host, plugin, third]), openThree());

  assert.deepEqual(composed.hidden, [
    { owner: 'third', connectionId: 'future', reason: 'proposed-owner' }
  ]);
  assert.ok(!composed.bridges.some((bridge) => bridge.id === 'future'));
  // Proposal exclusion draws no stand-in of any kind.
  assert.equal(JSON.stringify(composed.bridges).includes('"hidden"'), false);
  assert.deepEqual(
    composed.projects.flatMap((project) => project.ports),
    []
  );
});

test('a proposed endpoint hides the claim even when the owner shows proposed content', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  const preview: ProjectConnection = {
    id: 'preview',
    source: { model: 'host', element: 'cli' },
    target: { model: 'third', element: 'beta' },
    title: 'Previews the future adapter',
    kind: 'uses',
    status: 'current',
    description: 'A current claim against a proposed endpoint.',
    evidence: ['src/plugins/preview.ts']
  };
  // The owner shows proposed content but the endpoint project does not: the owner's switch
  // never overrides the hidden proposed endpoint.
  const state = stateOf([
    { model: 'host', scene: 'overview', mode: 'open', view: view([], true) },
    { model: 'plugin', scene: 'overview', mode: 'open', view: view() },
    { model: 'third', scene: 'overview', mode: 'open', view: view() }
  ]);
  const composed = await compose(
    staticResolver([withConnection(host, preview), plugin, third]),
    state
  );

  assert.deepEqual(composed.hidden, [
    { owner: 'host', connectionId: 'preview', reason: 'proposed-endpoint' },
    { owner: 'third', connectionId: 'future', reason: 'proposed-owner' }
  ]);
  assert.ok(!composed.bridges.some((bridge) => bridge.id === 'preview'));
});

test('a proposed claim draws when its owner and both endpoints are eligible', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  const state = stateOf([
    { model: 'host', scene: 'overview', mode: 'open', view: view() },
    { model: 'plugin', scene: 'overview', mode: 'open', view: view() },
    { model: 'third', scene: 'overview', mode: 'open', view: view([], true) }
  ]);
  const composed = await compose(staticResolver([host, plugin, third]), state);

  assert.deepEqual(composed.hidden, []);
  const bridge = composed.bridges.find((candidate) => candidate.id === 'future')!;
  assert.equal(bridge.owner, 'third');
  assert.equal(bridge.status, 'proposed');
  // beta is top-level, so it draws as its own node once proposed content is eligible.
  assert.deepEqual(bridge.source.representative, { kind: 'node', id: 'beta' });
  assert.deepEqual(bridge.target.representative, { kind: 'node', id: 'core' });
  assert.equal(bridge.count, 1);
  assert.deepEqual(bridge.underlying, [{ owner: 'third', connectionId: 'future' }]);
});

test('identical claims bundle with a count and qualified underlying owners', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  // Same drawn pair (host core -> plugin core) and identical claim fields, but a different
  // exact source endpoint (host core instead of host cli) and different evidence.
  const echo: ProjectConnection = {
    id: 'echo',
    source: { model: 'host', element: 'core' },
    target: { model: 'plugin', element: 'cli' },
    title: 'Invokes plugin CLI',
    kind: 'uses',
    status: 'current',
    description: 'Fictional host-owned integration claim.',
    evidence: ['src/plugins/echo.ts']
  };
  // Same pair and endpoints but a different description: never bundled.
  const aside: ProjectConnection = {
    id: 'aside',
    source: { model: 'host', element: 'core' },
    target: { model: 'plugin', element: 'cli' },
    title: 'Invokes plugin CLI',
    kind: 'uses',
    status: 'current',
    description: 'A differently described claim stays separate.',
    evidence: []
  };
  const withEchoes: ProjectSnapshot = {
    ...plugin,
    links: plugin.links
      ? { ...plugin.links, connections: [...plugin.links.connections, echo, aside] }
      : plugin.links
  };
  const composed = await compose(staticResolver([host, withEchoes, third]), openThree());

  const bundled = composed.bridges.filter(
    (bridge) => bridge.title === 'Invokes plugin CLI' && bridge.kind === 'uses'
  );
  assert.equal(bundled.length, 2);
  const bundle = bundled.find((bridge) => bridge.count === 2)!;
  // The lexicographically first owner draws the bundle.
  assert.equal(bundle.owner, 'host');
  assert.equal(bundle.id, 'call');
  assert.deepEqual(bundle.underlying, [
    { owner: 'host', connectionId: 'call' },
    { owner: 'plugin', connectionId: 'echo' }
  ]);
  assert.deepEqual(
    bundle.labelLines,
    wrapText('Invokes plugin CLI ×2', EDGE_LABEL_WIDTH, EDGE_LABEL_SIZE)
  );
  const single = bundled.find((bridge) => bridge.count === 1)!;
  assert.equal(single.id, 'aside');
  assert.deepEqual(single.underlying, [{ owner: 'plugin', connectionId: 'aside' }]);
});

test('reverse-direction claims never bundle', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  // Identical fields to the host call but reversed endpoints.
  const callback: ProjectConnection = {
    id: 'callback',
    source: { model: 'plugin', element: 'cli' },
    target: { model: 'host', element: 'cli' },
    title: 'Invokes plugin CLI',
    kind: 'uses',
    status: 'current',
    description: 'Fictional host-owned integration claim.',
    evidence: []
  };
  const composed = await compose(
    staticResolver([withConnection(host, callback), plugin, third]),
    openThree()
  );

  const pair = composed.bridges.filter((bridge) => bridge.title === 'Invokes plugin CLI');
  assert.equal(pair.length, 2);
  for (const bridge of pair) assert.equal(bridge.count, 1);
  assert.deepEqual(
    pair.map((bridge) => [bridge.source.model, bridge.target.model].join('>')).sort(),
    ['host>plugin', 'plugin>host']
  );
});

test('inspectConnection lists every underlying claim with exact endpoints and evidence', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  const echo: ProjectConnection = {
    id: 'echo',
    source: { model: 'host', element: 'core' },
    target: { model: 'plugin', element: 'cli' },
    title: 'Invokes plugin CLI',
    kind: 'uses',
    status: 'current',
    description: 'Fictional host-owned integration claim.',
    evidence: ['src/plugins/echo.ts']
  };
  const withEcho = withConnection(plugin, echo);
  const composed = await compose(staticResolver([host, withEcho, third]), openThree());
  const snapshots = new Map([
    ['host', host],
    ['plugin', withEcho],
    ['third', third]
  ]);

  const inspection = inspectQualified(composed, snapshots, {
    kind: 'connection',
    ownerModel: 'host',
    connectionId: 'call'
  });
  if (inspection.kind !== 'connection') throw new Error('expected connection inspection');
  assert.equal(inspection.count, 2);
  assert.deepEqual(
    inspection.underlying.map((entry) => [entry.owner, entry.connectionId]),
    [
      ['host', 'call'],
      ['plugin', 'echo']
    ]
  );
  // Exact endpoints stay distinct: the plugin echo starts at the host core card itself.
  assert.deepEqual(inspection.underlying[0].endpoints, {
    source: { model: 'host', element: 'cli' },
    target: { model: 'plugin', element: 'cli' }
  });
  assert.deepEqual(inspection.underlying[1].endpoints, {
    source: { model: 'host', element: 'core' },
    target: { model: 'plugin', element: 'cli' }
  });
  assert.deepEqual(inspection.underlying[0].evidence, ['src/plugins/beacon.ts']);
  assert.deepEqual(inspection.underlying[1].evidence, ['src/plugins/echo.ts']);

  // Any underlying claim resolves the same drawn bridge with its own exact endpoints.
  const echoInspection = inspectQualified(composed, snapshots, {
    kind: 'connection',
    ownerModel: 'plugin',
    connectionId: 'echo'
  });
  if (echoInspection.kind !== 'connection') throw new Error('expected connection inspection');
  assert.equal(echoInspection.owner, 'host');
  assert.deepEqual(echoInspection.endpoints, {
    source: { model: 'host', element: 'core' },
    target: { model: 'plugin', element: 'cli' }
  });
  assert.deepEqual(echoInspection.route.target, {
    project: 'Beacon plugin',
    component: 'Plugin CLI'
  });
  assert.equal(echoInspection.count, 2);
  assert.equal(echoInspection.underlying.length, 2);
});

test('cyclic links reuse frames: one frame per participating project', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  const composed = await compose(staticResolver([host, plugin, third]), openThree());

  // host -> plugin -> host is a cycle; third points back into it. Every model yields one frame.
  assert.deepEqual(
    composed.projects.map((project) => project.model),
    ['host', 'plugin', 'third']
  );
  assert.deepEqual(composed.diagnostics, []);
  assert.deepEqual(
    composed.bridges.map((bridge) => [bridge.owner, bridge.id]),
    [
      ['host', 'call'],
      ['plugin', 'call'],
      ['third', 'call']
    ]
  );
  // The third plugin's links both resolve, so it contributes no unopened-target stubs.
  assert.deepEqual(
    composed.stubs.map((stub) => [stub.owner, stub.linkId ?? stub.connectionId]),
    [['host', 'unavailable']]
  );
});

test('converging links share one target frame and draw a diamond', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  // With third showing proposed content, host and third both draw claims into plugin.
  const state = stateOf([
    { model: 'host', scene: 'overview', mode: 'open', view: view() },
    { model: 'plugin', scene: 'overview', mode: 'open', view: view() },
    { model: 'third', scene: 'overview', mode: 'open', view: view([], true) }
  ]);
  const composed = await compose(staticResolver([host, plugin, third]), state);

  const pluginFrames = composed.projects.filter((project) => project.model === 'plugin');
  assert.equal(pluginFrames.length, 1);
  const intoPlugin = composed.bridges.filter((bridge) => bridge.target.model === 'plugin');
  assert.deepEqual(
    intoPlugin.map((bridge) => [bridge.owner, bridge.id]),
    [
      ['host', 'call'],
      ['third', 'future']
    ]
  );
});

test('resolution only follows links for participating projects', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  // Only the root participates: nothing is resolved transitively and no frame is reused twice.
  const state = stateOf([{ model: 'host', scene: 'overview', mode: 'open', view: view() }]);
  const composed = await compose(staticResolver([host, plugin, third]), state);

  assert.deepEqual(
    composed.projects.map((project) => project.model),
    ['host']
  );
  assert.deepEqual(
    composed.stubs.map((stub) => [
      stub.owner,
      stub.linkId ?? stub.connectionId,
      stub.target.model,
      stub.state
    ]),
    [
      ['host', 'call', 'plugin', 'not_loaded'],
      ['host', 'plugin', 'plugin', 'not_loaded'],
      ['host', 'unavailable', 'missing-plugin', 'not_loaded']
    ]
  );
  assert.deepEqual(composed.bridges, []);
  assert.deepEqual(composed.hidden, []);
});

test('opening an already participating project is idempotent', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  const lookup = (model: string): ProjectSnapshot | undefined =>
    model === 'host' ? host : model === 'plugin' ? plugin : model === 'third' ? third : undefined;

  assert.deepEqual(openProject(openThree(), third), openThree());
  assert.deepEqual(openProject(openThree(), host), openThree());
  assert.deepEqual(parseCompositionState(openProject(openThree(), third)), openThree());

  const fromAuthored = stateFromComposition(host, 'plugins', lookup);
  assert.deepEqual(
    fromAuthored.projects.map((project) => project.model),
    ['host', 'plugin']
  );
  assert.deepEqual(stateFromComposition(host, 'plugins', lookup), fromAuthored);
  assert.deepEqual(openProject(fromAuthored, plugin), fromAuthored);
  assert.deepEqual(
    openProject(fromAuthored, third).projects.map((project) => project.model),
    ['host', 'plugin', 'third']
  );
});

test('reverse and repeated claims keep both owners and provenance', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  const state = stateOf([
    { model: 'host', scene: 'overview', mode: 'open', view: view() },
    { model: 'plugin', scene: 'overview', mode: 'open', view: view() },
    { model: 'third', scene: 'overview', mode: 'open', view: view([], true) }
  ]);
  const composed = await compose(staticResolver([host, plugin, third]), state);

  // The colliding `call` ID stays qualified: all three owners draw their own claim.
  assert.deepEqual(
    composed.bridges.map((bridge) => [bridge.owner, bridge.id]),
    [
      ['host', 'call'],
      ['plugin', 'call'],
      ['third', 'call'],
      ['third', 'future']
    ]
  );
  // The reverse pair draws in both directions with independent provenance.
  const forward = composed.bridges.find((bridge) => bridge.owner === 'host')!;
  const reverse = composed.bridges.find((bridge) => bridge.owner === 'plugin')!;
  assert.deepEqual([forward.source.model, forward.target.model], ['host', 'plugin']);
  assert.deepEqual([reverse.source.model, reverse.target.model], ['plugin', 'host']);
  assert.deepEqual(
    composed.bridges.map((bridge) => bridge.evidence),
    [['src/plugins/beacon.ts'], [], ['src/plugins/relay.ts'], []]
  );
});

test('setProjectScene re-derives the view from the scene and drops overrides', async () => {
  const [host, plugin] = await Promise.all([snapshot('host'), snapshot('plugin')]);
  const scoped = setProjectScope(openThree(), 'plugin', 'core');
  const proposed = parseCompositionState({
    ...scoped,
    projects: scoped.projects.map((project) =>
      project.model === 'plugin'
        ? { ...project, view: { ...project.view, proposed: true, expanded: ['core'] } }
        : project
    )
  });
  assert.equal(proposed.projects[1].view.scope, 'core');

  const back = setProjectScene(proposed, 'plugin', 'overview', plugin);
  assert.equal(back.projects[1].scene, 'overview');
  // The overview scene carries no scope and no proposed content: overrides are gone, not merged.
  assert.deepEqual(back.projects[1].view, {
    expanded: [],
    proposed: false,
    lens: 'structure'
  });
  assert.deepEqual(parseCompositionState(back), back);

  const detail = setProjectScene(back, 'plugin', 'detail', plugin);
  assert.equal(detail.projects[1].scene, 'detail');
  assert.deepEqual(detail.projects[1].view.expanded, ['core']);

  assert.throws(() => setProjectScene(back, 'absent', 'overview', plugin), /Unknown project/);
  assert.throws(() => setProjectScene(back, 'plugin', 'absent', plugin), /Unknown scene/);
  assert.throws(() => setProjectScene(back, 'plugin', 'overview', host), /does not describe/);
});

test('setProjectScope sets and clears the scope filter', async () => {
  const scoped = setProjectScope(openThree(), 'plugin', 'core');
  assert.equal(scoped.projects[1].view.scope, 'core');
  assert.deepEqual(parseCompositionState(scoped), scoped);

  const cleared = setProjectScope(scoped, 'plugin', undefined);
  assert.equal('scope' in cleared.projects[1].view, false);
  assert.deepEqual(parseCompositionState(cleared), cleared);

  assert.throws(() => setProjectScope(openThree(), 'absent', 'core'), /Unknown project/);
});

test('focusProject focuses and clears the focused project', async () => {
  const focused = focusProject(openThree(), 'plugin');
  assert.equal(focused.focusedProject, 'plugin');
  assert.deepEqual(parseCompositionState(focused), focused);

  const cleared = focusProject(focused, undefined);
  assert.equal(cleared.focusedProject, undefined);

  assert.throws(() => focusProject(openThree(), 'absent'), /must participate/);
});

test('a proposed claim to an unopened target hides when the owner switch is off', async () => {
  const [host, third] = await Promise.all([snapshot('host'), snapshot('third')]);
  const pair = (thirdProposed: boolean): CompositionState =>
    stateOf([
      { model: 'host', scene: 'overview', mode: 'open', view: view() },
      { model: 'third', scene: 'overview', mode: 'open', view: view([], thirdProposed) }
    ]);

  const off = await compose(staticResolver([host, third]), pair(false));
  assert.deepEqual(off.hidden, [
    { owner: 'third', connectionId: 'future', reason: 'proposed-owner' }
  ]);
  assert.ok(!off.stubs.some((stub) => stub.connectionId === 'future'));
  // Navigation links are unaffected: the unopened plugin still reads as a link stub.
  assert.ok(
    off.stubs.some(
      (stub) => stub.owner === 'third' && stub.linkId === 'plugin' && stub.state === 'not_loaded'
    )
  );

  const on = await compose(staticResolver([host, third]), pair(true));
  assert.deepEqual(on.hidden, []);
  const stub = on.stubs.find((candidate) => candidate.connectionId === 'future')!;
  assert.equal(stub.owner, 'third');
  assert.deepEqual(stub.target, { model: 'plugin', element: 'cli' });
  assert.equal(stub.state, 'not_loaded');
});

test('port bridges stay out of title bands and compose stays deterministic', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  const stock: ProjectConnection = {
    id: 'stock',
    source: { model: 'host', element: 'cli' },
    target: { model: 'plugin', element: 'store' },
    title: 'Reads plugin records',
    kind: 'reads',
    status: 'current',
    description: 'Fictional stock check against the plugin store.',
    evidence: []
  };
  const resolver = () => staticResolver([withConnection(host, stock), plugin, third]);
  for (const engine of ['elk-layered', 'elk-layered-down'] as const) {
    const state = stateOf(
      [
        { model: 'host', scene: 'overview', mode: 'open', view: view() },
        { model: 'plugin', scene: 'overview', mode: 'open', view: view([], false, 'core') },
        { model: 'third', scene: 'overview', mode: 'open', view: view() }
      ],
      engine
    );
    const first = await compose(resolver(), state);
    const second = await compose(resolver(), state);
    assert.deepEqual(first, second);

    const projects = new Map(first.projects.map((project) => [project.model, project]));
    assert.ok(first.bridges.length >= 1, `${engine} has bridges`);
    for (const bridge of first.bridges) {
      const label = `${engine} ${bridge.owner}/${bridge.id}`;
      for (const project of first.projects)
        for (let index = 1; index < bridge.points.length; index++)
          assert.equal(
            crossesRect(bridge.points[index - 1], bridge.points[index], titleBand(project)),
            false,
            `${label} segment ${index} crosses the ${project.model} title band`
          );
      const source = projects.get(bridge.source.model)!;
      const target = projects.get(bridge.target.model)!;
      if (engine === 'elk-layered') {
        const [left, right] =
          source.frame.x <= target.frame.x ? [source, target] : [target, source];
        assert.ok(
          bridge.label.x > left.frame.x + left.frame.width && bridge.label.x < right.frame.x,
          `${label} label x ${bridge.label.x} is outside the corridor`
        );
      } else {
        const [top, bottom] =
          source.frame.y <= target.frame.y ? [source, target] : [target, source];
        assert.ok(
          bridge.label.y > top.frame.y + top.frame.height && bridge.label.y < bottom.frame.y,
          `${label} label y ${bridge.label.y} is outside the corridor`
        );
      }
    }
    // The scoped-out store port exists on exactly one side with a measured label.
    const ports = projects.get('plugin')!.ports;
    assert.equal(ports.length, 1);
    assert.ok(ports[0].labelLines.length >= 1 && ports[0].labelLines[0].length >= 1);
  }
});

function pointInside(point: Point, rect: Frame): boolean {
  return (
    point.x > rect.x &&
    point.x < rect.x + rect.width &&
    point.y > rect.y &&
    point.y < rect.y + rect.height
  );
}

function assertBridgesAvoidNonEndpoints(
  composed: Awaited<ReturnType<typeof compose>>,
  label: string
): void {
  assert.ok(composed.bridges.length >= 1, `${label} has bridges`);
  for (const project of composed.projects)
    assert.ok(
      project.titleHeight <= project.frame.height,
      `${label} ${project.model} title band fits in its frame`
    );
  for (const bridge of composed.bridges) {
    const others = composed.projects.filter(
      (project) => project.model !== bridge.source.model && project.model !== bridge.target.model
    );
    for (const other of others) {
      for (let index = 1; index < bridge.points.length; index++)
        assert.equal(
          crossesRect(bridge.points[index - 1], bridge.points[index], other.frame),
          false,
          `${label} ${bridge.owner}/${bridge.id} segment ${index} crosses ${other.model}`
        );
      assert.equal(
        pointInside(bridge.label, other.frame),
        false,
        `${label} ${bridge.owner}/${bridge.id} label sits inside ${other.model}`
      );
    }
  }
}

const modes = ['open', 'collapsed'] as const;
const engines = ['elk-layered', 'elk-layered-down'] as const;

test('three-frame bridges never cross a non-endpoint frame, for every engine and collapse mix', async () => {
  const [host, plugin, third] = await Promise.all([
    snapshot('host'),
    snapshot('plugin'),
    snapshot('third')
  ]);
  for (const engine of engines) {
    for (const hostMode of modes) {
      for (const pluginMode of modes) {
        for (const thirdMode of modes) {
          const state = stateOf(
            [
              { model: 'host', scene: 'overview', mode: hostMode, view: view() },
              { model: 'plugin', scene: 'overview', mode: pluginMode, view: view() },
              { model: 'third', scene: 'overview', mode: thirdMode, view: view() }
            ],
            engine
          );
          const composed = await compose(staticResolver([host, plugin, third]), state);
          assertBridgesAvoidNonEndpoints(
            composed,
            `${engine} host=${hostMode} plugin=${pluginMode} third=${thirdMode}`
          );
        }
      }
    }
  }
});

function chainElement(id: string, title: string, parent: string | null): Element {
  return {
    id,
    sourceId: id,
    parent,
    title,
    kind: parent ? 'component' : 'subsystem',
    description: '',
    technology: '',
    status: 'current',
    color: '#267566',
    evidence: []
  };
}

function chainSnapshot(id: string, hops: string[]): ProjectSnapshot {
  const model: Model = {
    version: 1,
    id,
    title: id,
    description: '',
    provenance: '',
    elements: [chainElement('core', `${id} core`, null), chainElement('cli', `${id} cli`, 'core')],
    relationships: [],
    boundaries: [],
    scenes: [
      {
        id: 'overview',
        title: 'Overview',
        description: '',
        expanded: [],
        proposed: false,
        lens: 'structure'
      }
    ]
  };
  return {
    id,
    model,
    links: {
      version: 1,
      links: hops.map((target) => ({
        id: target,
        from: 'cli',
        target: { model: target, scene: 'overview' },
        title: `To ${target}`
      })),
      connections: hops.map((target) => ({
        id: `${id}-${target}`,
        source: { model: id, element: 'cli' },
        target: { model: target, element: 'cli' },
        title: `${id} to ${target}`,
        kind: 'uses',
        status: 'current' as const,
        description: '',
        evidence: []
      })),
      compositions: []
    },
    origins: { elements: { core: 'explicit', cli: 'explicit' }, relationships: {} },
    revision: id
  };
}

test('a generated chain of 4 never crosses a non-endpoint frame', async () => {
  const a = chainSnapshot('a', ['b', 'd']);
  const b = chainSnapshot('b', ['c']);
  const c = chainSnapshot('c', ['d']);
  const d = chainSnapshot('d', []);
  const ids = ['a', 'b', 'c', 'd'] as const;
  for (const engine of engines) {
    for (let mask = 0; mask < 16; mask++) {
      const state = parseCompositionState({
        version: 1,
        root: 'a',
        projects: ids.map((model, index) => ({
          model,
          scene: 'overview',
          mode: mask & (1 << index) ? 'collapsed' : 'open',
          view: view()
        })),
        theme: 'grove',
        layout: engine
      });
      const composed = await compose(staticResolver([a, b, c, d]), state);
      assertBridgesAvoidNonEndpoints(composed, `${engine} mask=${mask}`);
    }
  }
});

test('a current claim whose local endpoint is proposal-hidden is not stubbed', async () => {
  const [host, third] = await Promise.all([snapshot('host'), snapshot('third')]);
  const future = third.links!.connections.find((connection) => connection.id === 'future')!;
  const rewritten: ProjectSnapshot = {
    ...third,
    links: {
      ...third.links!,
      connections: third.links!.connections.map((connection) =>
        connection.id === 'future' ? { ...future, status: 'current' } : connection
      )
    }
  };
  const composed = await compose(
    staticResolver([host, rewritten]),
    stateOf([
      { model: 'host', scene: 'overview', mode: 'open', view: view() },
      { model: 'third', scene: 'overview', mode: 'open', view: view([], false) }
    ])
  );
  assert.equal(
    composed.stubs.some((stub) => stub.connectionId === 'future'),
    false
  );
  assert.deepEqual(
    composed.hidden.filter((claim) => claim.connectionId === 'future'),
    [{ owner: 'third', connectionId: 'future', reason: 'proposed-endpoint' }]
  );
});
